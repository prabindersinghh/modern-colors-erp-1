import { BadRequestException } from '@nestjs/common';
import { CartonStatus, PackingListStatus } from '@prisma/client';
import { PackingService } from './packing.service';

/**
 * The packing LIST confirm — the factory's real workflow.
 *
 * ONE confirm mints a PG for EVERY entry (straights AND combos, no exceptions), sequential,
 * in ONE transaction. Under the hood every entry is still a Carton, so the per-carton
 * invariants are unchanged; this proves the batch-confirm mints them all together.
 */
describe('PackingService list confirm', () => {
  const packer = { id: 'p1', role: 'PACKER' } as never;

  const build = (over: Record<string, any> = {}) => {
    let seq = 0;
    const tx: Record<string, any> = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'L1' }]),
      $queryRawUnsafe: jest.fn().mockImplementation(() => Promise.resolve([{ v: BigInt(++seq) }])),
      packingList: {
        findUnique: jest.fn().mockResolvedValue({ id: 'L1', status: PackingListStatus.DRAFT, packedById: 'p1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      carton: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', _count: { items: 1 } }, // straight
          { id: 'c2', _count: { items: 3 } }, // combo
          { id: 'c3', _count: { items: 1 } }, // straight
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      ...over,
    };
    const prisma = {
      ...tx,
      $transaction: (fn: (t: unknown) => unknown) => fn(tx),
      // this.packingList() reads AFTER the transaction — return a confirmed shell.
      packingList: {
        ...tx.packingList,
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'L1', status: PackingListStatus.DRAFT, packedById: 'p1' })
          .mockResolvedValue({ id: 'L1', status: PackingListStatus.CONFIRMED, packedById: 'p1', cartons: [] }),
      },
    };
    const audit = { log: jest.fn() };
    return { svc: new PackingService(prisma as never, audit as never, {} as never), tx, audit };
  };

  it('mints a PG for EVERY entry, sequential, in one transaction', async () => {
    const { svc, tx, audit } = build();
    await svc.confirmList(packer, 'L1');
    // three entries → three carton.update calls, each with a sequential PG- id
    const pgs = tx.carton.update.mock.calls.map((c: any) => c[0].data.uniqueId);
    expect(pgs).toEqual(['PG-000001', 'PG-000002', 'PG-000003']);
    // every carton got confirmedAt (frozen)
    for (const c of tx.carton.update.mock.calls) expect(c[0].data.confirmedAt).toBeInstanceOf(Date);
    // the list flips to CONFIRMED
    expect(tx.packingList.update.mock.calls[0][0].data.status).toBe(PackingListStatus.CONFIRMED);
    // audited with the full PG set
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PACKING_LIST_CONFIRMED', after: expect.objectContaining({ entries: 3 }) }),
      expect.anything(),
    );
  });

  it('refuses to confirm a list with no unconfirmed entries', async () => {
    const { svc } = build({ carton: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() } });
    await expect(svc.confirmList(packer, 'L1')).rejects.toThrow(BadRequestException);
  });

  it('refuses a list holding an empty entry', async () => {
    const { svc } = build({
      carton: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', _count: { items: 0 } }]), update: jest.fn() },
    });
    await expect(svc.confirmList(packer, 'L1')).rejects.toThrow(/no units/);
  });

  it('refuses to edit/confirm an already-confirmed list', async () => {
    const { svc } = build({
      packingList: { findUnique: jest.fn().mockResolvedValue({ id: 'L1', status: PackingListStatus.CONFIRMED, packedById: 'p1' }) },
    });
    await expect(svc.confirmList(packer, 'L1')).rejects.toThrow(/already confirmed/);
  });
});
