import { BadRequestException, ConflictException } from '@nestjs/common';
import { CartonStatus, FgStatus } from '@prisma/client';
import { PackingService } from './packing.service';

/**
 * Carton lifecycle invariants, at the service, against the mocked prisma.
 *
 * The rules that must never drift:
 *  - a unit is scanned in only from GENERATED; a double scan-in is refused;
 *  - a confirmed carton is FROZEN — it cannot be edited (add/remove);
 *  - an empty carton cannot be confirmed;
 *  - voiding RELEASES the contents back to UNDER_PACKING and drops the membership rows,
 *    and a dispatched/voided carton cannot be voided again.
 */
describe('PackingService carton invariants', () => {
  const packer = { id: 'p1', role: 'PACKER' } as never;

  /** Transactional prisma double: $transaction(fn) runs fn against the same mock. */
  const build = (over: Record<string, any> = {}) => {
    const tx: Record<string, any> = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'c1' }]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ v: 5n }]),
      carton: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1', uniqueId: 'DRAFT-c1', status: CartonStatus.DRAFT, confirmedAt: null,
          packedById: 'p1', packedBy: { name: 'Packer' }, packedAt: null, items: [],
        }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
      cartonItem: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([{ id: 'ci1', finishedGoodId: 'fg1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      finishedGood: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ...over,
    };
    const prisma = { ...tx, $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
    const audit = { log: jest.fn() };
    const reprints = {};
    const sessions = { assertOpen: async () => 'sess' };
    return { svc: new PackingService(prisma as never, audit as never, reprints as never, sessions as never), tx, audit };
  };

  describe('scan-in', () => {
    it('rejects a non-finished-goods code', async () => {
      const { svc } = build();
      await expect(svc.scanIn(packer, 'MC-000001')).rejects.toThrow(/not a finished-goods code/);
    });

    it('refuses to scan in a unit already under packing', async () => {
      const { svc } = build({
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'fg1', status: FgStatus.UNDER_PACKING, uniqueId: 'FG-000001' }]),
      });
      await expect(svc.scanIn(packer, 'FG-000001')).rejects.toThrow(/already under packing/);
    });

    it('moves a GENERATED unit to UNDER_PACKING and audits it', async () => {
      const { svc, tx, audit } = build({
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'fg1', status: FgStatus.GENERATED, uniqueId: 'FG-000001' }]),
        finishedGood: {
          update: jest.fn().mockImplementation(({ data }) => ({ id: 'fg1', uniqueId: 'FG-000001', family: 'FINISHED_GOOD', ...data })),
          updateMany: jest.fn(),
        },
      });
      await svc.scanIn(packer, 'FG-000001', 'phone');
      expect(tx.finishedGood.update.mock.calls[0][0].data.status).toBe(FgStatus.UNDER_PACKING);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'FG_UNDER_PACKING' }), expect.anything());
    });
  });

  describe('confirm', () => {
    it('refuses an empty carton', async () => {
      const { svc } = build({
        cartonItem: { count: jest.fn().mockResolvedValue(0) },
      });
      await expect(svc.confirmCarton(packer, 'c1')).rejects.toThrow(BadRequestException);
    });

    it('mints a PG and freezes an already-confirmed carton cannot be confirmed twice', async () => {
      // A confirmed carton fails the editable lock (confirmedAt set) → edit/confirm refused.
      const { svc } = build({
        carton: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'c1', uniqueId: 'PG-000005', status: CartonStatus.DRAFT, confirmedAt: new Date(), packedById: 'p1',
          }),
        },
      });
      await expect(svc.confirmCarton(packer, 'c1')).rejects.toThrow(/confirmed and can no longer be edited/);
    });
  });

  describe('edit after confirm', () => {
    it('refuses to add an item to a confirmed carton', async () => {
      const { svc } = build({
        carton: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'c1', uniqueId: 'PG-000005', status: CartonStatus.DRAFT, confirmedAt: new Date(), packedById: 'p1',
          }),
        },
      });
      await expect(svc.addItem(packer, 'c1', 'FG-000001')).rejects.toThrow(/confirmed and can no longer be edited/);
    });
  });

  describe('void', () => {
    it('releases the contents back to UNDER_PACKING and drops the membership rows', async () => {
      const { svc, tx, audit } = build({
        carton: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ id: 'c1', uniqueId: 'PG-000005', status: CartonStatus.PACKED, confirmedAt: new Date(), packedById: 'p1' })
            // second call is the returned this.carton(...)
            .mockResolvedValue({ id: 'c1', uniqueId: 'PG-000005', status: CartonStatus.VOIDED, confirmedAt: new Date(), packedById: 'p1', packedBy: { name: 'P' }, items: [] }),
          update: jest.fn().mockResolvedValue({}),
        },
        cartonItem: {
          findMany: jest.fn().mockResolvedValue([{ id: 'ci1', finishedGoodId: 'fg1' }, { id: 'ci2', finishedGoodId: 'fg2' }]),
          deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        finishedGood: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      });
      await svc.voidCarton(packer, 'c1', 'wrong drum');
      // units reset to UNDER_PACKING…
      expect(tx.finishedGood.updateMany.mock.calls[0][0].data.status).toBe(FgStatus.UNDER_PACKING);
      // …membership rows deleted (freeing the UNIQUE)…
      expect(tx.cartonItem.deleteMany).toHaveBeenCalledWith({ where: { cartonId: 'c1' } });
      // …carton VOIDED with a reason, audited.
      expect(tx.carton.update.mock.calls[0][0].data.status).toBe(CartonStatus.VOIDED);
      expect(tx.carton.update.mock.calls[0][0].data.voidReason).toBe('wrong drum');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CARTON_VOIDED' }), expect.anything());
    });

    it('requires a reason', async () => {
      const { svc } = build();
      await expect(svc.voidCarton(packer, 'c1', '   ')).rejects.toThrow(BadRequestException);
    });

    it('refuses to void a dispatched carton', async () => {
      const { svc } = build({
        carton: {
          findUnique: jest.fn().mockResolvedValue({ id: 'c1', uniqueId: 'PG-000005', status: CartonStatus.DISPATCHED, confirmedAt: new Date(), packedById: 'p1' }),
        },
      });
      await expect(svc.voidCarton(packer, 'c1', 'too late')).rejects.toThrow(ConflictException);
    });
  });
});
