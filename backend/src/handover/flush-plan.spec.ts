import * as fs from 'fs';
import * as path from 'path';

/**
 * Validates the handover flush plan WITHOUT touching a database.
 *
 * The flush runs exactly once, on handover day, against live data. There is no second
 * attempt and no undo beyond a Neon snapshot. The two things most likely to be quietly
 * wrong are the delete ORDER (a foreign key blocks a delete halfway through, leaving the
 * database half-wiped) and the PRESERVE list (someone adds a model and forgets it).
 *
 * These assertions are derived from prisma/schema.prisma, so ADDING A MODEL OR RELATION
 * THAT BREAKS THE FLUSH FAILS HERE rather than in front of the client.
 */
describe('handover flush plan', () => {
  const PRISMA_DIR = path.join(__dirname, '..', '..', 'prisma');
  const schema = fs.readFileSync(path.join(PRISMA_DIR, 'schema.prisma'), 'utf8');
  const flushSrc = fs.readFileSync(path.join(PRISMA_DIR, 'flush.ts'), 'utf8');

  /** Delete order, read out of flush.ts so the test tracks the real script. */
  const deleteOrder: string[] = (() => {
    const block = flushSrc.match(/const DELETE_ORDER = \[([\s\S]*?)\] as const;/);
    if (!block) throw new Error('DELETE_ORDER not found in flush.ts');
    return [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  })();

  /** Every model declared in the schema. */
  const models: string[] = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);

  /**
   * child -> [parents]. A relation line with `fields: [...]` means THIS model holds the
   * foreign key, so this model is the child and must be deleted first.
   */
  const parentsOf = (() => {
    const map = new Map<string, Set<string>>();
    for (const model of models) {
      const body = schema.match(new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, 'm'))?.[1] ?? '';
      const set = new Set<string>();
      for (const line of body.split('\n')) {
        if (!line.includes('@relation') || !line.includes('fields:')) continue;
        // e.g.  "po  PurchaseOrder @relation(fields: [poId], references: [id])"
        const target = line.trim().split(/\s+/)[1]?.replace(/[?[\]]/g, '');
        if (target && target !== model) set.add(target);
      }
      map.set(model, set);
    }
    return map;
  })();

  const PRESERVED = ['User', 'Setting'];
  const CONDITIONAL = ['MasterCatalogueItem']; // kept unless --flush-catalogue

  it('accounts for every model in the schema', () => {
    // A model that is neither deleted nor explicitly preserved would silently survive
    // the flush and hand the factory stale data.
    const accounted = new Set([...deleteOrder, ...PRESERVED, ...CONDITIONAL]);
    const unaccounted = models.filter((m) => !accounted.has(m));
    expect(unaccounted).toEqual([]);
  });

  it('deletes every child before the parent it references', () => {
    const pos = new Map(deleteOrder.map((m, i) => [m, i]));
    const violations: string[] = [];

    for (const child of deleteOrder) {
      for (const parent of parentsOf.get(child) ?? []) {
        // Preserved parents are never deleted, so ordering against them is moot.
        if (PRESERVED.includes(parent)) continue;
        const childPos = pos.get(child)!;
        const parentPos = pos.get(parent);
        if (parentPos === undefined) continue; // conditional (catalogue) — handled below
        if (childPos > parentPos) {
          violations.push(`${child} (pos ${childPos}) deleted AFTER its parent ${parent} (pos ${parentPos})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('never deletes users or settings', () => {
    // Wiping these would lock the factory out and destroy the encrypted Claude key.
    for (const p of PRESERVED) expect(deleteOrder).not.toContain(p);
  });

  it('keeps the catalogue out of the unconditional delete list', () => {
    // The catalogue may be the factory's real 500-600 SKUs, so it is opt-in only.
    expect(deleteOrder).not.toContain('MasterCatalogueItem');
    expect(flushSrc).toContain('--flush-catalogue');
  });

  it('requires BOTH an env flag and a typed confirmation before deleting', () => {
    expect(flushSrc).toMatch(/ALLOW_FLUSH === 'yes'/);
    expect(flushSrc).toMatch(/CONFIRM_PHRASE/);
    expect(flushSrc).toMatch(/const APPLY = ALLOW && CONFIRMED/);
  });

  it('resets all three unique-ID sequences', () => {
    // Without this the factory's first sack is MC-000351, not MC-000001 — and the same
    // applies to its first drum and its first receiving slip.
    expect(flushSrc).toContain('material_unique_seq');
    expect(flushSrc).toContain('finished_good_unique_seq');
    expect(flushSrc).toContain('receiving_slip_seq');
    expect(flushSrc).toMatch(/RESTART WITH 1/);
  });

  it('cleans up stored invoice files so they do not accumulate cost', () => {
    expect(flushSrc).toMatch(/ListObjectsV2Command/);
    expect(flushSrc).toMatch(/DeleteObjectsCommand/);
    // Scoped to the invoice prefix, never the whole bucket.
    expect(flushSrc).toMatch(/Prefix: 'po\/'/);
  });

  it('documents the append-only exception and the ENCRYPTION_KEY warning', () => {
    // These must live where a maintainer reading the script will actually see them.
    expect(flushSrc).toMatch(/append-only/i);
    expect(flushSrc).toMatch(/I4/);
    expect(flushSrc).toMatch(/ENCRYPTION_KEY/);
    expect(flushSrc).toMatch(/unrecoverable/i);
  });
});
