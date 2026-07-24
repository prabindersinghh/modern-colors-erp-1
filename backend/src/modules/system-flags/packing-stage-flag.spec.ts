import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ALLOW_ACCESS_FLIP_KEY } from '../../common/decorators/allow-access-flip.decorator';
import { SystemFlagsAdminController } from './system-flags.controller';
import { SystemFlagsService, PACKING_STAGE, FLAG_OFF, FLAG_ON } from './system-flags.service';

/**
 * The packing-stage flag. Unlike the inward flag it defaults OFF — deploying it changes
 * nothing until the owner flips it. It rides the SAME @AllowAccessFlip door as the inward
 * flag (one door, two keys), and both directions are audited.
 */
describe('PACKING_STAGE flag', () => {
  const reflector = new Reflector();

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

  it('defaults OFF when no row exists — deploying it forces nothing', async () => {
    const { svc } = build();
    expect(await svc.get(PACKING_STAGE, FLAG_OFF)).toBe(FLAG_OFF);
  });

  it('audits the flip in both directions', async () => {
    const { svc, audit } = build();
    await svc.set(PACKING_STAGE, FLAG_ON, 'owner');
    expect(audit.log.mock.calls[0][0]).toMatchObject({ action: 'PACKING_STAGE_CHANGED', after: { value: FLAG_ON } });
    await svc.set(PACKING_STAGE, FLAG_OFF, 'owner');
    expect(audit.log.mock.calls[1][0]).toMatchObject({ after: { value: FLAG_OFF } });
  });

  it('is flipped through the SAME access-flip door as the inward flag (door count stays four)', () => {
    // Both the inward flip (set) and the packing flip (setPacking) carry @AllowAccessFlip,
    // on the SAME controller — so the door SET is unchanged.
    for (const handler of ['set', 'setPacking'] as const) {
      const marked = reflector.getAllAndOverride<boolean>(ALLOW_ACCESS_FLIP_KEY, [
        SystemFlagsAdminController.prototype[handler] as never,
        SystemFlagsAdminController,
      ]);
      expect(marked).toBe(true);
    }
  });

  it('the packing flip carries NO @Roles — the named door is the only gate', () => {
    const { ROLES_KEY } = require('../../common/decorators/roles.decorator');
    const roles = reflector.getAllAndOverride(ROLES_KEY, [
      SystemFlagsAdminController.prototype.setPacking as never,
      SystemFlagsAdminController,
    ]);
    expect(roles).toBeUndefined();
  });
});
