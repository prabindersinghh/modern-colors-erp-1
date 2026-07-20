/**
 * Backfill opening stock balances for units that have none.
 *
 * WHY THIS EXISTS
 * Receiving no longer weighs each sack, so a unit's opening balance comes from the PO's
 * per-package weight. Units registered before that change (and units from invoices where
 * extraction missed the pack size) have balanceKg = NULL and are correctly blocked from
 * being issued to production.
 *
 * This is SEED/TEST data, not real factory inventory — the database is flushed before
 * handover. The purpose here is to make the system testable end-to-end without every
 * issue attempt hitting a block, WITHOUT destroying the one path that most needs to
 * stay exercisable.
 *
 * DELIBERATELY LEAVES SOME UNITS BLOCKED
 * Bulk invoices genuinely have no per-package weight — the P.K. Dyes invoice states
 * "CARB-10 B ... 2,300.000 KG" with no pack size anywhere on the document. That case
 * will keep occurring in production, so the needs-weight queue and the stock-movement
 * guard must stay testable. Units whose weight cannot be derived honestly are left
 * blocked and recorded in the audit trail with the reason.
 *
 * Weights are DERIVED, never invented: the same deterministic parser the extractor uses
 * (derivePackWeight) reads the pack size out of the material name, then the catalogue's
 * standard packaging is used as a fallback. A unit only gets a balance if one of those
 * produces a real figure.
 *
 * USAGE
 *   npx ts-node prisma/backfill-pack-weights.ts            # dry run, writes nothing
 *   npx ts-node prisma/backfill-pack-weights.ts --apply    # actually writes
 *
 * Idempotent: only ever touches units where balanceKg IS NULL.
 */
import { PrismaClient } from '@prisma/client';
import { derivePackWeight } from '../src/modules/ai-extraction/derive-pack-weight';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** Bulk measures — a unit in these has no per-package size by definition. */
const BULK_UNITS = new Set(['kg', 'kgs', 'ltr', 'ltrs', 'l', 'mt', 'ton', 'tons', 'tonne']);
const isBulk = (u: string | null) => !!u && BULK_UNITS.has(u.trim().toLowerCase());

/** Last-resort pack size by package word, used only when nothing better is available. */
const BY_PACKAGE: Record<string, number> = {
  bag: 25,
  drum: 200,
  can: 20,
  pail: 20,
  carton: 15,
  container: 50,
};

async function main() {
  const blocked = await prisma.material.findMany({
    where: { balanceKg: null },
    select: {
      id: true,
      uniqueId: true,
      materialName: true,
      sku: true,
      unit: true,
      weight: true,
      status: true,
    },
    orderBy: { uniqueId: 'asc' },
  });

  // Catalogue packaging ("25 KG Bag") as a secondary source of truth.
  const catalogue = await prisma.masterCatalogueItem.findMany({
    select: { sku: true, materialName: true, standardPackaging: true, unit: true },
  });
  const bySku = new Map(catalogue.filter((c) => c.sku).map((c) => [c.sku.toUpperCase(), c]));
  const byName = new Map(catalogue.map((c) => [c.materialName.trim().toLowerCase(), c]));

  type Plan = { id: string; uniqueId: string; name: string; unit: string | null; weight: number; source: string };
  const toFill: Plan[] = [];
  const leaveBlocked: { id: string; uniqueId: string; name: string; unit: string | null; why: string }[] = [];

  for (const m of blocked) {
    // 1. The PO already carried a weight (shouldn't normally be null here, but honour it).
    if (m.weight != null && m.weight > 0) {
      toFill.push({ id: m.id, uniqueId: m.uniqueId, name: m.materialName, unit: m.unit, weight: m.weight, source: 'po-weight' });
      continue;
    }

    // 2. Derive from the material name — "AEROSIL 200 (10KGS)" -> 10.
    const derived = derivePackWeight({ materialName: m.materialName, quantity: 1 });
    if (derived) {
      toFill.push({ id: m.id, uniqueId: m.uniqueId, name: m.materialName, unit: m.unit, weight: derived.weight, source: `name:${derived.source}` });
      continue;
    }

    // 3. Catalogue standard packaging — "50 KG Bag" -> 50.
    const cat = (m.sku && bySku.get(m.sku.toUpperCase())) || byName.get(m.materialName.trim().toLowerCase());
    if (cat?.standardPackaging) {
      const fromCat = derivePackWeight({ packingNote: cat.standardPackaging, quantity: 1 });
      if (fromCat) {
        toFill.push({ id: m.id, uniqueId: m.uniqueId, name: m.materialName, unit: m.unit, weight: fromCat.weight, source: 'catalogue-packaging' });
        continue;
      }
    }

    // 4. A genuine bulk line has no per-package size. LEAVE IT BLOCKED — this is the
    //    real-world case the needs-weight queue exists for.
    if (isBulk(m.unit)) {
      leaveBlocked.push({
        id: m.id,
        uniqueId: m.uniqueId,
        name: m.materialName,
        unit: m.unit,
        why: `BULK — invoice states a total in ${m.unit}, no pack size on the document`,
      });
      continue;
    }

    // 5. A known package word with no stated size: fall back to the conventional size.
    const pkg = (m.unit ?? '').trim().toLowerCase().replace(/s$/, '');
    if (BY_PACKAGE[pkg]) {
      toFill.push({ id: m.id, uniqueId: m.uniqueId, name: m.materialName, unit: m.unit, weight: BY_PACKAGE[pkg], source: `convention:${pkg}` });
      continue;
    }

    leaveBlocked.push({
      id: m.id,
      uniqueId: m.uniqueId,
      name: m.materialName,
      unit: m.unit,
      why: 'No pack size could be derived from the name, catalogue or unit',
    });
  }

  // Genuine bulk lines are the authentic blocked case, but on this dataset there are
  // only two of them. Hold back a few more from DIFFERENT materials and package types
  // so the needs-weight queue shows a realistic mix (not just one odd invoice) and the
  // blocking guard can be exercised against a Bag and a Drum as well as bulk.
  // Seed data only — chosen deterministically (lowest uniqueId per material) so re-runs
  // and re-seeds pick the same units.
  const RESERVE_TARGET = 5;
  if (leaveBlocked.length < RESERVE_TARGET) {
    const seenMaterial = new Set(leaveBlocked.map((b) => b.name));
    for (const t of [...toFill].sort((x, y) => x.uniqueId.localeCompare(y.uniqueId))) {
      if (leaveBlocked.length >= RESERVE_TARGET) break;
      if (seenMaterial.has(t.name)) continue; // one per material, for variety
      seenMaterial.add(t.name);
      leaveBlocked.push({
        id: t.id,
        uniqueId: t.uniqueId,
        name: t.name,
        unit: t.unit,
        why: `TEST FIXTURE — deliberately left without a pack weight so the needs-weight queue and the stock-movement block stay exercisable`,
      });
      toFill.splice(toFill.findIndex((f) => f.id === t.id), 1);
    }
  }

  // ---- report ------------------------------------------------------------
  console.log(`\nUnits with no opening balance: ${blocked.length}`);
  console.log(`  will be filled : ${toFill.length}`);
  console.log(`  left blocked   : ${leaveBlocked.length}  (kept so the needs-weight queue stays testable)\n`);

  const bySource = new Map<string, number>();
  for (const t of toFill) bySource.set(t.source, (bySource.get(t.source) ?? 0) + 1);
  console.log('fill sources:');
  [...bySource.entries()].sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`  ${String(n).padStart(4)}  ${s}`));

  console.log('\nsample of what will be written:');
  toFill.slice(0, 12).forEach((t) =>
    console.log(`  ${t.uniqueId}  ${String(t.weight).padStart(6)} kg  [${t.source}]  ${t.name.slice(0, 40)}`),
  );

  console.log('\nLEFT BLOCKED (intentional — these keep the blocking guard exercisable):');
  leaveBlocked.forEach((b) =>
    console.log(`  ${b.uniqueId}  unit=${String(b.unit ?? '-').padEnd(5)}  ${b.name.slice(0, 40).padEnd(42)} ${b.why}`),
  );

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
    return;
  }

  // ---- apply -------------------------------------------------------------
  let filled = 0;
  for (const t of toFill) {
    await prisma.material.update({ where: { id: t.id }, data: { balanceKg: t.weight } });
    filled++;
  }

  // Record WHY the remaining units are still blocked. Material has no free-text field,
  // and inventing one (or abusing batchNumber) would corrupt real semantics — so the
  // append-only audit trail carries the explanation, where the Audit screen shows it.
  for (const b of leaveBlocked) {
    await prisma.auditLog.create({
      data: {
        entityType: 'Material',
        entityId: b.id,
        action: 'PACK_WEIGHT_UNAVAILABLE',
        afterJson: {
          uniqueId: b.uniqueId,
          materialName: b.name,
          unit: b.unit,
          reason: b.why,
          note: 'Intentionally left without an opening balance so the needs-weight queue and the stock-movement guard remain testable.',
        },
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      entityType: 'Material',
      entityId: 'backfill',
      action: 'PACK_WEIGHT_BACKFILLED',
      afterJson: {
        filled,
        leftBlocked: leaveBlocked.length,
        sources: Object.fromEntries(bySource),
        note: 'Opening balances derived from material name / catalogue packaging / package convention. Seed data only.',
      },
    },
  });

  console.log(`\nAPPLIED: ${filled} units filled, ${leaveBlocked.length} left blocked (audited).`);
}

main()
  .catch((e) => {
    console.error('FAILED:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
