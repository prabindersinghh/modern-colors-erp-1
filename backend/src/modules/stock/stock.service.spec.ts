import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RequestStatus, Role, StockTxnType } from '@prisma/client';
import { StockService } from './stock.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Unit tests for the stock movement rules. Prisma's $transaction is faked with a
 * hand-rolled tx client so we exercise the branching (over-deduction, department
 * rules, request-line cap, QR mismatch, un-weighed block) without a DB.
 */

const store: AuthUser = {
  id: 'store-1',
  email: 'admin@moderncolours.local',
  role: Role.ADMIN,
  name: 'Store',
  department: null,
};

type UnitRow = { id: string; balanceKg: number | null; materialName: string; sku: string | null };

function makeService(opts: {
  unit: UnitRow;
  requestItem?: any;
}) {
  const updates: any = { material: null, txnCreated: null, itemUpdate: null };
  const tx = {
    $queryRaw: async () => (opts.unit ? [opts.unit] : []),
    productionRequestItem: {
      findUnique: async () => opts.requestItem ?? null,
      update: async ({ data }: any) => {
        updates.itemUpdate = data;
        return data;
      },
    },
    stockTransaction: {
      create: async ({ data }: any) => {
        updates.txnCreated = data;
        return { id: 'txn-1', ...data };
      },
    },
    material: {
      update: async ({ data }: any) => {
        updates.material = data;
        return data;
      },
      findUnique: async () => ({ ...opts.unit, uniqueId: 'MC-1' }),
    },
  };
  const prisma: any = { $transaction: async (fn: any) => fn(tx) };
  const audit: any = { log: async () => undefined };
  const service = new StockService(prisma, audit);
  return { service, updates };
}

const base = {
  uniqueId: 'MC-1',
  quantityKg: 5,
} as const;

describe('StockService.createTransaction', () => {
  it('ADD increases the balance and stores balanceAfter', async () => {
    const { service, updates } = makeService({
      unit: { id: 'u1', balanceKg: 10, materialName: 'Titanium Dioxide', sku: 'TIO2' },
    });
    const res = await service.createTransaction(store, {
      ...base,
      type: StockTxnType.ADD,
      quantityKg: 5,
      department: 'PU' as any,
    });
    expect(updates.material.balanceKg).toBe(15);
    expect(res.transaction.balanceAfter).toBe(15);
  });

  it('DEDUCT within balance lowers it', async () => {
    const { service, updates } = makeService({
      unit: { id: 'u1', balanceKg: 10, materialName: 'X', sku: null },
    });
    await service.createTransaction(store, {
      ...base,
      type: StockTxnType.DEDUCT,
      quantityKg: 4,
      department: 'PU' as any,
    });
    expect(updates.material.balanceKg).toBe(6);
  });

  it('blocks over-deduction (never goes negative)', async () => {
    const { service } = makeService({
      unit: { id: 'u1', balanceKg: 3, materialName: 'X', sku: null },
    });
    await expect(
      service.createTransaction(store, {
        ...base,
        type: StockTxnType.DEDUCT,
        quantityKg: 5,
        department: 'PU' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks over-discard too', async () => {
    const { service } = makeService({
      unit: { id: 'u1', balanceKg: 2, materialName: 'X', sku: null },
    });
    await expect(
      service.createTransaction(store, { ...base, type: StockTxnType.DISCARD, quantityKg: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a department for ADD/DEDUCT', async () => {
    const { service } = makeService({
      unit: { id: 'u1', balanceKg: 10, materialName: 'X', sku: null },
    });
    await expect(
      service.createTransaction(store, { ...base, type: StockTxnType.DEDUCT, quantityKg: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DISCARD forces department to null', async () => {
    const { service, updates } = makeService({
      unit: { id: 'u1', balanceKg: 10, materialName: 'X', sku: null },
    });
    await service.createTransaction(store, {
      ...base,
      type: StockTxnType.DISCARD,
      quantityKg: 4,
      department: 'PU' as any, // should be ignored
    });
    expect(updates.txnCreated.department).toBeNull();
    expect(updates.material.balanceKg).toBe(6);
  });

  it('rejects a zero/negative quantity', async () => {
    const { service } = makeService({
      unit: { id: 'u1', balanceKg: 10, materialName: 'X', sku: null },
    });
    await expect(
      service.createTransaction(store, {
        ...base,
        type: StockTxnType.ADD,
        quantityKg: 0,
        department: 'PU' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks movement on an un-weighed unit (balanceKg null)', async () => {
    const { service } = makeService({
      unit: { id: 'u1', balanceKg: null, materialName: 'X', sku: null },
    });
    await expect(
      service.createTransaction(store, {
        ...base,
        type: StockTxnType.ADD,
        quantityKg: 1,
        department: 'PU' as any,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404 when the scanned unit does not exist', async () => {
    const { service } = makeService({ unit: undefined as any });
    await expect(
      service.createTransaction(store, {
        ...base,
        type: StockTxnType.ADD,
        quantityKg: 1,
        department: 'PU' as any,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('request-driven deduction', () => {
    const approvedLine = {
      id: 'item-1',
      status: RequestStatus.APPROVED,
      approvedKg: 10,
      issuedKg: 0,
      materialName: 'Titanium Dioxide',
      sku: 'TIO2',
      request: { id: 'req-1', department: 'PU' },
    };

    it('issues against an approved line and bumps issuedKg', async () => {
      const { service, updates } = makeService({
        unit: { id: 'u1', balanceKg: 20, materialName: 'Titanium Dioxide', sku: 'TIO2' },
        requestItem: approvedLine,
      });
      await service.createTransaction(store, {
        ...base,
        type: StockTxnType.DEDUCT,
        quantityKg: 4,
        department: 'PU' as any,
        requestItemId: 'item-1',
      });
      expect(updates.itemUpdate.issuedKg).toBe(4);
      expect(updates.itemUpdate.fulfilledAt).toBeUndefined(); // 4 < 10
    });

    it('stamps fulfilledAt when issued reaches approved', async () => {
      const { service, updates } = makeService({
        unit: { id: 'u1', balanceKg: 20, materialName: 'Titanium Dioxide', sku: 'TIO2' },
        requestItem: { ...approvedLine, issuedKg: 6 },
      });
      await service.createTransaction(store, {
        ...base,
        type: StockTxnType.DEDUCT,
        quantityKg: 4,
        department: 'PU' as any,
        requestItemId: 'item-1',
      });
      expect(updates.itemUpdate.issuedKg).toBe(10);
      expect(updates.itemUpdate.fulfilledAt).toBeInstanceOf(Date);
    });

    it('blocks issuing more than the approved amount', async () => {
      const { service } = makeService({
        unit: { id: 'u1', balanceKg: 50, materialName: 'Titanium Dioxide', sku: 'TIO2' },
        requestItem: { ...approvedLine, issuedKg: 8 },
      });
      await expect(
        service.createTransaction(store, {
          ...base,
          type: StockTxnType.DEDUCT,
          quantityKg: 5, // 8 + 5 > 10
          department: 'PU' as any,
          requestItemId: 'item-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('hard-blocks a material (QR) mismatch', async () => {
      const { service } = makeService({
        unit: { id: 'u1', balanceKg: 20, materialName: 'Iron Oxide Red', sku: 'FEOR-110' },
        requestItem: approvedLine, // wants Titanium Dioxide / TIO2
      });
      await expect(
        service.createTransaction(store, {
          ...base,
          type: StockTxnType.DEDUCT,
          quantityKg: 1,
          department: 'PU' as any,
          requestItemId: 'item-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks a department mismatch against the request line', async () => {
      const { service } = makeService({
        unit: { id: 'u1', balanceKg: 20, materialName: 'Titanium Dioxide', sku: 'TIO2' },
        requestItem: approvedLine, // PU
      });
      await expect(
        service.createTransaction(store, {
          ...base,
          type: StockTxnType.DEDUCT,
          quantityKg: 1,
          department: 'ENAMEL' as any,
          requestItemId: 'item-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects issuing against a non-approved (pending) line', async () => {
      const { service } = makeService({
        unit: { id: 'u1', balanceKg: 20, materialName: 'Titanium Dioxide', sku: 'TIO2' },
        requestItem: { ...approvedLine, status: RequestStatus.PENDING },
      });
      await expect(
        service.createTransaction(store, {
          ...base,
          type: StockTxnType.DEDUCT,
          quantityKg: 1,
          department: 'PU' as any,
          requestItemId: 'item-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects linking a request line to a non-DEDUCT movement', async () => {
      const { service } = makeService({
        unit: { id: 'u1', balanceKg: 20, materialName: 'Titanium Dioxide', sku: 'TIO2' },
        requestItem: approvedLine,
      });
      await expect(
        service.createTransaction(store, {
          ...base,
          type: StockTxnType.ADD,
          quantityKg: 1,
          department: 'PU' as any,
          requestItemId: 'item-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

describe('StockService.levels (aggregation)', () => {
  function serviceWithUnits(units: any[]) {
    const prisma: any = { material: { findMany: async () => units } };
    return new StockService(prisma, { log: async () => undefined } as any);
  }

  it('groups units of the same material (by sku) and sums balances', async () => {
    const service = serviceWithUnits([
      { uniqueId: 'MC-1', materialName: 'Titanium Dioxide', sku: 'TIO2', status: 'READY_FOR_PRODUCTION', balanceKg: 24 },
      { uniqueId: 'MC-2', materialName: 'Titanium Dioxide', sku: 'TIO2', status: 'READY_FOR_PRODUCTION', balanceKg: 6 },
      { uniqueId: 'MC-3', materialName: 'Calcium Carbonate', sku: 'CACO3', status: 'READY_FOR_PRODUCTION', balanceKg: 2 },
    ]);
    const res = await service.levels({});
    expect(res.materials).toHaveLength(2);
    const tio2 = res.materials.find((m) => m.sku === 'TIO2')!;
    expect(tio2.totalBalanceKg).toBe(30);
    expect(tio2.unitCount).toBe(2);
    expect(res.grandTotalKg).toBe(32);
    expect(res.unitCount).toBe(3);
  });

  it('falls back to name when a unit has no sku', async () => {
    const service = serviceWithUnits([
      { uniqueId: 'MC-9', materialName: 'Zinc Oxide White', sku: null, status: 'READY_FOR_PRODUCTION', balanceKg: 5 },
      { uniqueId: 'MC-10', materialName: 'Zinc Oxide White', sku: null, status: 'READY_FOR_PRODUCTION', balanceKg: 3 },
    ]);
    const res = await service.levels({});
    expect(res.materials).toHaveLength(1);
    expect(res.materials[0].totalBalanceKg).toBe(8);
  });
});
