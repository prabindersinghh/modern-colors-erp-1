import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { StoreInwardGuard } from '../../common/guards/store-inward.guard';
import { AccessFlipGuard } from '../../common/guards/access-flip.guard';
import { Reflector } from '@nestjs/core';
import { SystemFlagsAdminController } from './system-flags.controller';
import { SystemFlagsService, STORE_INWARD_ACCESS, FLAG_ON, FLAG_OFF } from './system-flags.service';

/**
 * The cutover flip — the one control that decides whether the Store desk still reaches
 * the inward flow.
 *
 * What is pinned here:
 *  - it governs the STORE DESK AND NOBODY ELSE. Gate must be untouched in BOTH states,
 *    because Gate is what receives the trucks: if the flag could reach Gate, flipping it
 *    would stop the factory rather than reorganise it;
 *  - it defaults ON, and an unreadable database still reads ON, so neither deploying the
 *    guard nor a transient outage can revoke anything by itself;
 *  - both directions are audited — restoring access is history too;
 *  - only OVERSIGHT can flip it, through a two-sided named door.
 */

const ctx = (role?: Role) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }) }) as never;

const flagsReturning = (value: string) =>
  ({ get: jest.fn().mockResolvedValue(value) }) as unknown as SystemFlagsService;

describe('StoreInwardGuard governs the Store desk only', () => {
  const OTHERS = [Role.OPERATOR, Role.OVERSIGHT, Role.SUPERVISOR, Role.PRODUCTION_HEAD, Role.DISPATCH, Role.REVIEWER];

  it('flag ON: Store passes (today’s reality — the cutover is reversible)', async () => {
    const guard = new StoreInwardGuard(flagsReturning(FLAG_ON));
    await expect(guard.canActivate(ctx(Role.ADMIN))).resolves.toBe(true);
  });

  it('flag OFF: Store is refused, with an explanation rather than a bare 403', async () => {
    const guard = new StoreInwardGuard(flagsReturning(FLAG_OFF));
    await expect(guard.canActivate(ctx(Role.ADMIN))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx(Role.ADMIN))).rejects.toThrow(/moved to the Gate desk/);
  });

  it.each(OTHERS)('GATE and every other role are untouched with the flag OFF — %s', async (role) => {
    // The whole point: flipping this can never stop a truck being received, because
    // receiving belongs to Gate.
    const guard = new StoreInwardGuard(flagsReturning(FLAG_OFF));
    await expect(guard.canActivate(ctx(role))).resolves.toBe(true);
  });

  it.each(OTHERS)('…and with the flag ON — %s', async (role) => {
    const guard = new StoreInwardGuard(flagsReturning(FLAG_ON));
    await expect(guard.canActivate(ctx(role))).resolves.toBe(true);
  });

  it('never even reads the flag for a non-Store role', async () => {
    const flags = flagsReturning(FLAG_OFF);
    await new StoreInwardGuard(flags).canActivate(ctx(Role.OPERATOR));
    expect(flags.get).not.toHaveBeenCalled();
  });
});

describe('the flag fails OPEN, never closed', () => {
  const build = () => {
    const prisma = {
      systemFlag: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create, update }) => ({ ...create, ...update })),
      },
    };
    const audit = { log: jest.fn() };
    return { svc: new SystemFlagsService(prisma as never, audit as never), prisma, audit };
  };

  it('an absent row reads as ON, so deploying the guard revokes nothing', async () => {
    const { svc } = build();
    expect(await svc.get(STORE_INWARD_ACCESS, FLAG_ON)).toBe(FLAG_ON);
  });

  it('a database error reads as ON rather than locking the desk out', async () => {
    const { svc, prisma } = build();
    prisma.systemFlag.findUnique.mockRejectedValueOnce(new Error('connection reset'));
    expect(await svc.get(STORE_INWARD_ACCESS, FLAG_ON)).toBe(FLAG_ON);
  });

  it('caches, and the write invalidates so the flipper sees it at once', async () => {
    const { svc, prisma } = build();
    prisma.systemFlag.findUnique.mockResolvedValue({ key: STORE_INWARD_ACCESS, value: FLAG_OFF });
    expect(await svc.get(STORE_INWARD_ACCESS, FLAG_ON)).toBe(FLAG_OFF);
    await svc.get(STORE_INWARD_ACCESS, FLAG_ON);
    expect(prisma.systemFlag.findUnique).toHaveBeenCalledTimes(1); // second read served from cache

    await svc.set(STORE_INWARD_ACCESS, FLAG_ON, 'owner');
    prisma.systemFlag.findUnique.mockResolvedValue({ key: STORE_INWARD_ACCESS, value: FLAG_ON });
    expect(await svc.get(STORE_INWARD_ACCESS, FLAG_ON)).toBe(FLAG_ON); // re-read, not stale
  });

  it('audits BOTH directions with before and after', async () => {
    const { svc, audit } = build();
    await svc.set(STORE_INWARD_ACCESS, FLAG_OFF, 'owner');
    expect(audit.log.mock.calls[0][0]).toMatchObject({
      action: 'STORE_INWARD_ACCESS_CHANGED',
      actorId: 'owner',
      after: { value: FLAG_OFF },
    });
    await svc.set(STORE_INWARD_ACCESS, FLAG_ON, 'owner');
    expect(audit.log.mock.calls[1][0]).toMatchObject({ after: { value: FLAG_ON } });
  });
});

describe('AccessFlipGuard is two-sided, like the other three doors', () => {
  const guard = new AccessFlipGuard(new Reflector());
  const doorCtx = (handler: unknown, role?: Role) =>
    ({
      getHandler: () => handler,
      getClass: () => SystemFlagsAdminController,
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    }) as never;
  const marked = SystemFlagsAdminController.prototype.set;

  it('refuses an UNMARKED handler even for OVERSIGHT', () => {
    expect(() => guard.canActivate(doorCtx(function unmarked() {}, Role.OVERSIGHT))).toThrow(ForbiddenException);
  });

  it('refuses every role except OVERSIGHT — Store cannot restore its own access', () => {
    for (const r of [Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR, Role.PRODUCTION_HEAD, Role.DISPATCH, Role.REVIEWER]) {
      expect(() => guard.canActivate(doorCtx(marked, r))).toThrow(ForbiddenException);
    }
  });

  it('passes OVERSIGHT on the marked handler', () => {
    expect(guard.canActivate(doorCtx(marked, Role.OVERSIGHT))).toBe(true);
  });
});
