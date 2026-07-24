import { ConflictException } from '@nestjs/common';
import { CartonStatus, FgStatus } from '@prisma/client';
import { DispatchService } from './dispatch.service';

/**
 * Gap A — a unit a packer has taken into a carton can NEVER be shipped out from under him
 * by a direct FG scan. This holds regardless of the PACKING_STAGE flag: UNDER_PACKING and
 * PACKED units are refused with a 409 naming the state; only GENERATED/READY dispatch
 * directly (grandfathered). Plus the carton (PG) dispatch path: a VOIDED PG is refused.
 */
describe('Gap A — direct dispatch refuses packed / under-packing units', () => {
  const user = { id: 'd1', role: 'DISPATCH' } as never;

  const build = (over: Record<string, any> = {}) => {
    const tx: Record<string, any> = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'fg1', status: FgStatus.GENERATED }]),
      finishedGood: {
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'fg1', uniqueId: 'FG-000001', batch: { batchNumber: 'B1' }, productName: 'P', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      carton: { findUnique: jest.fn(), update: jest.fn() },
      ...over,
    };
    const prisma = { ...tx, $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
    const audit = { log: jest.fn() };
    const sessions = { assertOpen: jest.fn().mockResolvedValue('s') };
    return { svc: new DispatchService(prisma as never, audit as never, sessions as never), tx };
  };

  it('refuses a UNDER_PACKING unit on a direct scan', async () => {
    const { svc } = build({ $queryRaw: jest.fn().mockResolvedValue([{ id: 'fg1', status: FgStatus.UNDER_PACKING }]) });
    await expect(svc.dispatchUnit(user, 'FG-000001')).rejects.toThrow(/being packed into a carton/);
  });

  it('refuses a PACKED unit on a direct scan (scan the carton instead)', async () => {
    const { svc } = build({ $queryRaw: jest.fn().mockResolvedValue([{ id: 'fg1', status: FgStatus.PACKED }]) });
    await expect(svc.dispatchUnit(user, 'FG-000001')).rejects.toThrow(/packed into a carton/);
  });

  it('still dispatches a GENERATED unit directly (grandfathered path)', async () => {
    const { svc, tx } = build();
    await svc.dispatchUnit(user, 'FG-000001');
    expect(tx.finishedGood.update.mock.calls[0][0].data.status).toBe(FgStatus.DISPATCHED);
  });

  describe('carton dispatch path', () => {
    it('refuses a VOIDED PG — its label no longer describes a shippable carton', async () => {
      const { svc } = build({
        carton: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', status: CartonStatus.VOIDED, items: [] }) },
      });
      await expect(svc.dispatchCarton(user, 'PG-000001')).rejects.toThrow(/was voided/);
    });

    it('refuses a PG that is not yet marked packed', async () => {
      const { svc } = build({
        carton: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', status: CartonStatus.DRAFT, items: [] }) },
      });
      await expect(svc.dispatchCarton(user, 'PG-000001')).rejects.toThrow(/not yet marked packed/);
    });

    it('dispatches a PACKED carton and every unit inside it', async () => {
      const { svc, tx } = build({
        carton: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'c1', status: CartonStatus.PACKED,
            items: [{ finishedGoodId: 'fg1', finishedGood: { uniqueId: 'FG-000001' } }, { finishedGoodId: 'fg2', finishedGood: { uniqueId: 'FGHD-000001' } }],
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      const res = await svc.dispatchCarton(user, 'PG-000001');
      expect(res).toEqual({ pg: 'PG-000001', dispatched: 2 });
      expect(tx.carton.update.mock.calls[0][0].data.status).toBe(CartonStatus.DISPATCHED);
      expect(tx.finishedGood.updateMany.mock.calls[0][0].data.status).toBe(FgStatus.DISPATCHED);
    });

    it('refuses to dispatch an already-dispatched carton', async () => {
      const { svc } = build({
        carton: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', status: CartonStatus.DISPATCHED, items: [] }) },
      });
      await expect(svc.dispatchCarton(user, 'PG-000001')).rejects.toThrow(ConflictException);
    });
  });
});
