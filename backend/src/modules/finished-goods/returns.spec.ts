import { Reflector } from '@nestjs/core';
import { FgStatus, Role } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { FinishedGoodsController } from './finished-goods.controller';
import { ReturnsService } from './returns.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

/**
 * Returned finished goods — scrap / refurbish.
 *
 * The rules that must never drift:
 *  - ACCESS: acting on a return is DISPATCH-only. Admin/Oversight may read history.
 *  - Only a DISPATCHED unit can be returned; terminal states refuse a second pass.
 *  - A reason is REQUIRED — write-offs without a why are an audit hole.
 *  - REFURBISH mints a NEW identity but keeps the ORIGINAL batch + output and links
 *    via refurbishedFromId — it must trace to what it really is, never look new.
 */
describe('returns access control', () => {
  const reflector = new Reflector();
  const rolesFor = (handler: keyof FinishedGoodsController) =>
    reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      FinishedGoodsController.prototype[handler] as never,
      FinishedGoodsController,
    ]);

  it('lets only Dispatch scrap or refurbish a return', () => {
    for (const h of ['scrapReturn', 'refurbishReturn'] as const) {
      expect(rolesFor(h)).toEqual([Role.DISPATCH]);
    }
  });

  it('lets Dispatch act and Admin/Oversight read the history — nobody else', () => {
    const roles = rolesFor('returnsHistory');
    expect(roles).toEqual(expect.arrayContaining([Role.DISPATCH, Role.ADMIN, Role.OVERSIGHT]));
    for (const r of [Role.OPERATOR, Role.SUPERVISOR, Role.PRODUCTION_HEAD]) {
      expect(roles).not.toContain(r);
    }
  });
});

describe('ReturnsService lifecycle', () => {
  const user = { id: 'u1', role: 'DISPATCH' } as never;

  /** Transactional prisma double: $transaction(fn) runs fn against the same mock. */
  const build = (over: Record<string, unknown> = {}) => {
    const tx: Record<string, unknown> = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'fg1', status: FgStatus.DISPATCHED }]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ v: 42n }]),
      finishedGood: {
        update: jest.fn().mockImplementation(({ data }) => ({
          id: 'fg1',
          uniqueId: 'FG-000001',
          productName: 'Weathershield White',
          batch: { batchNumber: 'PU-B-1', department: 'PU' },
          ...data,
        })),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'fg1',
          uniqueId: 'FG-000001',
          family: 'FINISHED_GOOD',
          outputId: 'out1',
          batchId: 'b1',
          productName: 'Weathershield White',
          sizePerPackage: 20,
          sizeUnit: 'L',
          batch: { batchNumber: 'PU-B-1', department: 'PU' },
          output: { productionDate: new Date('2026-07-01'), shade: null, productSku: null },
        }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'fg2', ...data })),
      },
      finishedGoodQr: { create: jest.fn().mockResolvedValue({}) },
      ...over,
    };
    const prisma = { ...tx, $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
    const audit = { log: jest.fn() };
    const qr = { dataUrl: jest.fn().mockResolvedValue('data:image/png;base64,x') };
    return { svc: new ReturnsService(prisma as never, audit as never, qr as never), tx, audit };
  };

  it('requires a reason for both outcomes', async () => {
    const { svc } = build();
    await expect(svc.scrap(user, 'FG-000001', '  ')).rejects.toThrow(BadRequestException);
    await expect(svc.refurbish(user, 'FG-000001', '')).rejects.toThrow(BadRequestException);
  });

  it('rejects raw-material codes outright', async () => {
    const { svc } = build();
    await expect(svc.scrap(user, 'MC-000001', 'damaged')).rejects.toThrow(/not a finished-goods code/);
  });

  it('only a DISPATCHED unit can be returned', async () => {
    const { svc } = build({
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'fg1', status: FgStatus.GENERATED }]),
    });
    await expect(svc.scrap(user, 'FG-000001', 'damaged')).rejects.toThrow(/has not been dispatched/);
  });

  it('refuses a second pass on an already-processed return', async () => {
    for (const status of [FgStatus.SCRAPPED, FgStatus.REFURBISHED]) {
      const { svc } = build({ $queryRaw: jest.fn().mockResolvedValue([{ id: 'fg1', status }]) });
      await expect(svc.scrap(user, 'FG-000001', 'x')).rejects.toThrow(ConflictException);
      await expect(svc.refurbish(user, 'FG-000001', 'x')).rejects.toThrow(ConflictException);
    }
  });

  it('scrap marks the unit SCRAPPED with who/when/why, and audits it', async () => {
    const { svc, tx, audit } = build();
    await svc.scrap(user, 'FG-000001', 'drum leaked', 'phone');
    const update = (tx.finishedGood as { update: jest.Mock }).update.mock.calls[0][0];
    expect(update.data.status).toBe(FgStatus.SCRAPPED);
    expect(update.data.returnedById).toBe('u1');
    expect(update.data.returnNote).toBe('drum leaked');
    expect(update.data.returnedAt).toBeInstanceOf(Date);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FG_RETURN_SCRAPPED', actorId: 'u1' }),
      expect.anything(),
    );
  });

  it('refurbish mints a NEW unit on the ORIGINAL batch/output, linked to the original', async () => {
    const { svc, tx, audit } = build();
    const res = (await svc.refurbish(user, 'FG-000001', 'repacked')) as {
      replacement: { uniqueId: string };
    };

    const create = (tx.finishedGood as { create: jest.Mock }).create.mock.calls[0][0];
    // New identity from the FG sequence…
    expect(create.data.uniqueId).toBe('FG-000042');
    expect(res.replacement.uniqueId).toBe('FG-000042');
    // …but the REAL provenance: same batch and output as the original, plus lineage.
    expect(create.data.batchId).toBe('b1');
    expect(create.data.outputId).toBe('out1');
    expect(create.data.refurbishedFromId).toBe('fg1');
    // Back into sellable stock — it will appear in the dispatch queue again.
    expect(create.data.status).toBe(FgStatus.GENERATED);

    // The replacement gets its own QR.
    expect((tx.finishedGoodQr as { create: jest.Mock }).create).toHaveBeenCalled();

    // The original ends REFURBISHED — history intact under its own ID.
    const update = (tx.finishedGood as { update: jest.Mock }).update.mock.calls[0][0];
    expect(update.data.status).toBe(FgStatus.REFURBISHED);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FG_RETURN_REFURBISHED',
        after: expect.objectContaining({ replacementUniqueId: 'FG-000042' }),
      }),
      expect.anything(),
    );
  });

  // Gap B — a refurbished hardener/thinner must mint from its OWN family sequence and wear
  // its own prefix, never silently become a paint drum (FG-).
  it('refurbish copies the family: a returned HARDENER mints a new FGHD- unit', async () => {
    const { svc, tx } = build({
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'fg1', status: FgStatus.DISPATCHED }]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ v: 7n }]),
      finishedGood: {
        update: jest.fn().mockImplementation(({ data }) => ({
          id: 'fg1', uniqueId: 'FGHD-000001', productName: 'H', batch: { batchNumber: 'PU-B-1', department: 'PU' }, ...data,
        })),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'fg1', uniqueId: 'FGHD-000001', family: 'HARDENER', outputId: 'out1', batchId: 'b1',
          productName: 'Weathershield Hardener', sizePerPackage: 5, sizeUnit: 'Kg',
          batch: { batchNumber: 'PU-B-1', department: 'PU' },
          output: { productionDate: new Date('2026-07-01'), shade: null, productSku: null },
        }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'fg2', ...data })),
      },
    });
    await svc.refurbish(user, 'FGHD-000001', 'repacked');
    const create = (tx.finishedGood as { create: jest.Mock }).create.mock.calls[0][0];
    expect(create.data.family).toBe('HARDENER');
    expect(create.data.uniqueId).toBe('FGHD-000007'); // hardener series, not FG-
  });
});
