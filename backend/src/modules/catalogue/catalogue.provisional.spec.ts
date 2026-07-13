import { CatalogueService } from './catalogue.service';

// Provisional-SKU lifecycle (item: TMP- codes never silently pile up). We fake the
// Prisma client + audit so we can assert the count filter, the audited TMP→real edit,
// and the metadata flag being cleared — all without a database.
describe('CatalogueService — provisional SKU lifecycle', () => {
  function make(rows: any[]) {
    const audits: any[] = [];
    const db = rows;
    const prisma: any = {
      masterCatalogueItem: {
        findUnique: async ({ where }: any) =>
          db.find((r) => (where.id ? r.id === where.id : r.sku === where.sku)) ?? null,
        count: async ({ where }: any) => {
          const startsWith = where?.sku?.startsWith;
          return db.filter(
            (r) => (where.active ? r.active : true) && (startsWith ? r.sku.startsWith(startsWith) : true),
          ).length;
        },
        update: async ({ where, data }: any) => {
          const r = db.find((x) => x.id === where.id);
          Object.assign(r, data);
          return r;
        },
      },
    };
    const audit = { log: async (e: any) => audits.push(e) };
    const svc = new CatalogueService(prisma, audit as any);
    return { svc, audits, db };
  }

  it('counts only active TMP- entries', async () => {
    const { svc } = make([
      { id: '1', sku: 'TMP-AAA111', active: true },
      { id: '2', sku: 'TMP-BBB222', active: true },
      { id: '3', sku: 'REAL-1', active: true },
      { id: '4', sku: 'TMP-CCC333', active: false }, // deactivated — excluded
    ]);
    expect((await svc.provisionalCount()).count).toBe(2);
  });

  it('audits a TMP→real SKU change with before→after and clears the provisional flag', async () => {
    const { svc, audits, db } = make([
      { id: '1', sku: 'TMP-XYZ999', materialName: 'China Clay', active: true, metadata: { createdVia: 'operator-no-match', provisional: true } },
    ]);
    await svc.update('1', { sku: 'CLAY-001' } as any, 'admin-9');
    expect(db[0].sku).toBe('CLAY-001');
    // provisional flag removed, other metadata kept
    expect(db[0].metadata).toEqual({ createdVia: 'operator-no-match' });
    const a = audits.at(-1);
    expect(a.action).toBe('CATALOGUE_ITEM_SKU_CHANGED');
    expect(a.before.sku).toBe('TMP-XYZ999');
    expect(a.after.sku).toBe('CLAY-001');
    expect(a.actorId).toBe('admin-9');
  });

  it('rejects changing a SKU to one that already exists on another item', async () => {
    const { svc } = make([
      { id: '1', sku: 'TMP-XYZ999', materialName: 'A', active: true },
      { id: '2', sku: 'CLAY-001', materialName: 'B', active: true },
    ]);
    await expect(svc.update('1', { sku: 'CLAY-001' } as any, 'admin-9')).rejects.toThrow(/already exists/);
  });

  it('a non-SKU edit is logged as a plain update, not a SKU change', async () => {
    const { svc, audits } = make([
      { id: '1', sku: 'REAL-1', materialName: 'A', active: true, metadata: null },
    ]);
    await svc.update('1', { category: 'Pigment' } as any, 'admin-9');
    expect(audits.at(-1).action).toBe('CATALOGUE_ITEM_UPDATED');
  });
});
