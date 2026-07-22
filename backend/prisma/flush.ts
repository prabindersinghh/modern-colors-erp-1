/**
 * ============================================================================
 *  HANDOVER FLUSH — wipes all transactional data, keeps logins and settings.
 * ============================================================================
 *
 * Run ONCE, immediately before handing the system to the factory, so they start
 * from a genuinely empty system rather than months of demo and test data.
 *
 * WHAT IT KEEPS
 *   User      — all logins, hashed passwords, roles, departments
 *   Setting   — the ENCRYPTED Claude API key (see the warning below)
 *   MasterCatalogueItem — kept by DEFAULT. Wipe it only with --flush-catalogue,
 *               and only if the catalogue is still demo data rather than the
 *               factory's real ~500-600 SKUs.
 *
 * WHAT IT DELETES
 *   Every purchase order, line item, material unit, QR code, stock transaction,
 *   production request, batch, production output, finished good, FG QR — and the
 *   audit log (see the invariant note below).
 *   Optionally the uploaded invoice documents in object storage.
 *
 * ----------------------------------------------------------------------------
 *  !! AUDIT LOG — A DELIBERATE EXCEPTION TO AN INVARIANT !!
 * ----------------------------------------------------------------------------
 * Invariant I4 says the audit log is APPEND-ONLY: the application never updates or
 * deletes a row, and corrections are new entries that reference the original.
 *
 * This script breaks that invariant ON PURPOSE, exactly once, at handover. The
 * existing trail documents OUR development and testing, not the factory's
 * operations; carrying it into production would mean their permanent compliance
 * record opens with hundreds of entries about material that never existed.
 *
 * This is the ONLY place in the codebase permitted to delete audit rows. If you
 * find yourself wanting to delete audit rows anywhere else, that is a bug —
 * corrections are new entries, never deletions.
 *
 * ----------------------------------------------------------------------------
 *  !! ENCRYPTION_KEY — DO NOT CHANGE IT, EVER !!
 * ----------------------------------------------------------------------------
 * The Claude API key is stored AES-256-GCM encrypted, using ENCRYPTION_KEY from the
 * environment. That env var is the ONLY thing that can decrypt it.
 *
 * If ENCRYPTION_KEY is ever changed, rotated, or lost:
 *   - the stored Claude API key becomes permanently unrecoverable,
 *   - invoice AI extraction silently falls back to manual entry, and
 *   - the fix is to re-enter the key in Settings (Admin) — the old value cannot
 *     be recovered from a backup of the database alone.
 * Changing the DATABASE without changing ENCRYPTION_KEY is fine. Changing
 * ENCRYPTION_KEY is not.
 *
 * ----------------------------------------------------------------------------
 *  USAGE
 * ----------------------------------------------------------------------------
 *   # 1. Always dry-run first. Writes nothing.
 *   npx ts-node prisma/flush.ts
 *
 *   # 2. Real run. Needs BOTH the env flag and a typed confirmation.
 *   ALLOW_FLUSH=yes npx ts-node prisma/flush.ts --confirm "FLUSH MODERN COLOURS"
 *
 *   # Options
 *   --flush-catalogue   also wipe MasterCatalogueItem (default: KEEP)
 *   --keep-files        do NOT delete uploaded invoices from object storage
 *   --yes-really        skip the 10-second abort window (for scripted runs)
 *
 * BEFORE YOU RUN IT
 *   - Take a Neon branch/snapshot. This is not reversible from inside the app.
 *   - Point DATABASE_URL at the DIRECT (non-pooled) Neon host.
 *   - Confirm you are on the intended database — the script prints the host.
 */
import { PrismaClient } from '@prisma/client';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const prisma = new PrismaClient();

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);

const CONFIRM_PHRASE = 'FLUSH MODERN COLOURS';
const ALLOW = process.env.ALLOW_FLUSH === 'yes';
const CONFIRMED = arg('--confirm') === CONFIRM_PHRASE;
const FLUSH_CATALOGUE = has('--flush-catalogue');
const KEEP_FILES = has('--keep-files');
const SKIP_PAUSE = has('--yes-really');
const APPLY = ALLOW && CONFIRMED;

/**
 * Tables in FK-safe delete order: every child is deleted before the parent it
 * references. Verified against the LIVE constraint map in flush-order.spec.ts, so a
 * future model or relation change breaks a test rather than the handover.
 *
 * Batch sits AFTER ProductionRequestItem deliberately. ProductionRequestItem.batchId
 * is ON DELETE SET NULL, so deleting Batch first would technically work — but it
 * would issue a pointless UPDATE across rows that are about to be deleted anyway, and
 * it would leave the script depending on a referential action that a future schema
 * change could quietly flip to RESTRICT. Children first is unconditionally correct.
 */
const DELETE_ORDER = [
  // Reprint approvals reference PurchaseOrder, Material, ProductionOutput AND
  // FinishedGood, so they must go before all four — first is unconditionally safe.
  'LabelReprintRequest',
  'FinishedGoodQr',
  'FinishedGood',
  'ProductionOutput',
  'StockTransaction',
  'ProductionRequestItem',
  'ProductionRequest',
  'Batch',
  'QrCode',
  'Material',
  // References PurchaseOrder and User, so it must go before PurchaseOrder.
  'ReceivingSlip',
  'POLineItem',
  'PurchaseOrder',
  'AuditLog',
] as const;

/** Exported for the order test. */
export { DELETE_ORDER };

type Counts = Record<string, number>;

async function countAll(): Promise<Counts> {
  return {
    // Preserved
    User: await prisma.user.count(),
    Setting: await prisma.setting.count(),
    // Preserved deliberately: resetting this would restore Store's inward access.
    SystemFlag: await prisma.systemFlag.count(),
    MasterCatalogueItem: await prisma.masterCatalogueItem.count(),
    // Deleted
    PurchaseOrder: await prisma.purchaseOrder.count(),
    POLineItem: await prisma.pOLineItem.count(),
    Material: await prisma.material.count(),
    QrCode: await prisma.qrCode.count(),
    StockTransaction: await prisma.stockTransaction.count(),
    ProductionRequest: await prisma.productionRequest.count(),
    ProductionRequestItem: await prisma.productionRequestItem.count(),
    Batch: await prisma.batch.count(),
    ProductionOutput: await prisma.productionOutput.count(),
    FinishedGood: await prisma.finishedGood.count(),
    FinishedGoodQr: await prisma.finishedGoodQr.count(),
    LabelReprintRequest: await prisma.labelReprintRequest.count(),
    ReceivingSlip: await prisma.receivingSlip.count(),
    AuditLog: await prisma.auditLog.count(),
  };
}

const PRESERVED = new Set(['User', 'Setting', 'SystemFlag']);

function table(before: Counts, after?: Counts) {
  const rows = Object.keys(before);
  const w = Math.max(...rows.map((r) => r.length));
  console.log(`\n  ${'table'.padEnd(w)}  ${'before'.padStart(8)}${after ? `  ${'after'.padStart(8)}` : ''}   status`);
  console.log(`  ${'-'.repeat(w)}  ${'-'.repeat(8)}${after ? `  ${'-'.repeat(8)}` : ''}   ------`);
  for (const r of rows) {
    const keep =
      PRESERVED.has(r) || (r === 'MasterCatalogueItem' && !FLUSH_CATALOGUE);
    const status = keep ? 'KEEP' : 'DELETE';
    console.log(
      `  ${r.padEnd(w)}  ${String(before[r]).padStart(8)}` +
        (after ? `  ${String(after[r]).padStart(8)}` : '') +
        `   ${status}`,
    );
  }
}

/** Delete every stored invoice document. Returns how many objects were removed. */
async function purgeStorage(): Promise<number> {
  const driver = process.env.STORAGE_DRIVER;
  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (driver !== 'r2' || !bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    console.log('  storage: R2 not configured — skipping object cleanup.');
    return 0;
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  let removed = 0;
  let token: string | undefined;
  do {
    const list = await s3.send(
      // Only the invoice prefix — never the whole bucket, in case it is shared.
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'po/', ContinuationToken: token }),
    );
    const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
    if (keys.length > 0) {
      if (APPLY) {
        // ListObjectsV2 pages at 1000 and DeleteObjects caps at 1000, so one page
        // maps to exactly one delete call.
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
      }
      removed += keys.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);

  return removed;
}

/**
 * Restart the unique-ID sequences so the factory's first sack is MC-000001, its first
 * drum FG-000001 and its first receiving slip RS-000001, rather than continuing from our
 * test data. Without this the numbering is correct but confusing forever.
 */
async function resetSequences() {
  const sequences = ['material_unique_seq', 'finished_good_unique_seq', 'receiving_slip_seq'];
  for (const seq of sequences) {
    if (APPLY) {
      await prisma.$executeRawUnsafe(`ALTER SEQUENCE "${seq}" RESTART WITH 1`);
    }
    console.log(`  ${APPLY ? 'reset' : 'would reset'}: ${seq} -> 1`);
  }
}

async function main() {
  // Show which database is about to be hit — the single most important check.
  const dbUrl = process.env.DATABASE_URL ?? '';
  const host = dbUrl.replace(/^.*@/, '').replace(/\/.*$/, '') || '(unknown)';
  const dbName = (dbUrl.match(/\/([^/?]+)(\?|$)/) ?? [])[1] ?? '(unknown)';

  console.log('='.repeat(74));
  console.log('  MODERN COLOURS — HANDOVER FLUSH');
  console.log('='.repeat(74));
  console.log(`  database host : ${host}`);
  console.log(`  database name : ${dbName}`);
  console.log(`  catalogue     : ${FLUSH_CATALOGUE ? 'WILL BE WIPED (--flush-catalogue)' : 'KEPT (default)'}`);
  console.log(`  invoice files : ${KEEP_FILES ? 'KEPT (--keep-files)' : 'WILL BE DELETED from object storage'}`);
  console.log(`  mode          : ${APPLY ? '*** LIVE — WILL DELETE ***' : 'DRY RUN (nothing will be written)'}`);

  const before = await countAll();
  table(before);

  const toDelete = Object.entries(before)
    .filter(([k]) => !PRESERVED.has(k) && !(k === 'MasterCatalogueItem' && !FLUSH_CATALOGUE))
    .reduce((s, [, v]) => s + v, 0);
  console.log(`\n  rows to delete: ${toDelete}`);
  console.log(`  rows preserved: ${before.User} users, ${before.Setting} setting(s)` +
    (FLUSH_CATALOGUE ? '' : `, ${before.MasterCatalogueItem} catalogue items`));

  console.log('\n  NOTE: AuditLog deletion is a deliberate, one-time exception to the');
  console.log('        append-only invariant (I4). See the header of this file.');

  if (!APPLY) {
    console.log('\n  ' + '-'.repeat(70));
    if (!ALLOW) console.log('  DRY RUN — ALLOW_FLUSH=yes is not set.');
    if (!CONFIRMED) console.log(`  DRY RUN — pass: --confirm "${CONFIRM_PHRASE}"`);
    console.log('  Nothing was written.');
    console.log('  ' + '-'.repeat(70));
    if (!KEEP_FILES) {
      const n = await purgeStorage();
      console.log(`  storage: ${n} invoice object(s) WOULD be deleted.`);
    }
    await resetSequences();
    return;
  }

  // Last chance to abort.
  if (!SKIP_PAUSE) {
    console.log('\n  Starting in 10 seconds — press Ctrl+C to abort.');
    await new Promise((r) => setTimeout(r, 10_000));
  }

  console.log('\n  deleting (FK-safe order):');
  const client = prisma as unknown as Record<string, { deleteMany: () => Promise<{ count: number }> }>;
  for (const model of DELETE_ORDER) {
    // Prisma's delegate names are camelCase; POLineItem is pOLineItem.
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    const delegate = client[key] ?? client[model === 'POLineItem' ? 'pOLineItem' : key];
    const res = await delegate.deleteMany();
    console.log(`    ${model.padEnd(24)} ${String(res.count).padStart(7)} deleted`);
  }

  if (FLUSH_CATALOGUE) {
    const res = await prisma.masterCatalogueItem.deleteMany();
    console.log(`    ${'MasterCatalogueItem'.padEnd(24)} ${String(res.count).padStart(7)} deleted`);
  }

  console.log('\n  sequences:');
  await resetSequences();

  if (!KEEP_FILES) {
    console.log('\n  storage:');
    const n = await purgeStorage();
    console.log(`    ${n} invoice object(s) deleted from R2.`);
  }

  const after = await countAll();
  console.log('\n  RESULT:');
  table(before, after);

  // Re-open the trail with a single entry explaining the gap, so a future auditor
  // sees why the log starts where it does rather than suspecting tampering.
  await prisma.auditLog.create({
    data: {
      entityType: 'System',
      entityId: 'flush',
      action: 'SYSTEM_FLUSHED_FOR_HANDOVER',
      afterJson: {
        deletedRows: toDelete,
        cataloguePreserved: !FLUSH_CATALOGUE,
        filesPurged: !KEEP_FILES,
        note:
          'All pre-handover development and test data was removed and the unique-ID ' +
          'sequences reset. Deleting the prior audit log was a deliberate one-time ' +
          'exception to the append-only invariant (I4); no operational history was lost ' +
          'because the factory had not yet begun using the system.',
      },
    },
  });

  console.log('\n  Done. The system is empty and ready for the factory.');
  console.log('  Logins and the Claude API key are unchanged.\n');
}

main()
  .catch((e) => {
    console.error('\nFLUSH FAILED:', e instanceof Error ? e.message : e);
    console.error('Nothing further was deleted. Restore from your Neon snapshot if needed.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
