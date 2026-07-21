import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { HandoverService } from './handover.service';
import { HandoverController } from './handover.controller';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

/**
 * Handover readiness — read-only by construction, honest about defaults.
 * The flush itself stays a guarded script; this panel may inspect, never act.
 */
describe('handover readiness', () => {
  it('is readable by Store and factory Admin only', () => {
    const reflector = new Reflector();
    const roles = reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      HandoverController.prototype.readiness,
      HandoverController,
    ]);
    expect(roles).toEqual(expect.arrayContaining([Role.ADMIN, Role.OVERSIGHT]));
    for (const r of [Role.DISPATCH, Role.PRODUCTION_HEAD, Role.OPERATOR, Role.SUPERVISOR]) {
      expect(roles).not.toContain(r);
    }
  });

  it('flags logins still on a known default password — without revealing any password', async () => {
    const defaultHash = await bcrypt.hash('ChangeMe123!', 4);
    const changedHash = await bcrypt.hash('a-real-password-9!', 4);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { email: 'oversight@x', role: 'OVERSIGHT', passwordHash: defaultHash },
          { email: 'admin@x', role: 'ADMIN', passwordHash: changedHash },
        ]),
        count,
      },
      masterCatalogueItem: { count },
      finishedGoodQr: { count },
      finishedGood: { count },
      productionOutput: { count },
      stockTransaction: { count },
      productionRequestItem: { count },
      productionRequest: { count },
      batch: { count },
      qrCode: { count },
      material: { count },
      pOLineItem: { count },
      purchaseOrder: { count },
      auditLog: { count },
      setting: { count },
    };
    const storage = { healthCheck: jest.fn().mockResolvedValue({ ok: true, driver: 'r2' }) };
    const svc = new HandoverService(prisma as never, storage as never);

    const res = await svc.readiness();
    expect(res.logins.usingDefaults).toBe(1);
    const flagged = res.logins.accounts.find((a) => a.email === 'oversight@x')!;
    expect(flagged.usingDefaultPassword).toBe(true);
    // No password or hash ever leaves the server.
    expect(JSON.stringify(res)).not.toContain('ChangeMe123!');
    expect(JSON.stringify(res)).not.toContain(defaultHash);
    // The default-password login is called out as a blocker.
    expect(res.blockers.join(' ')).toMatch(/default password/);
  });

  it('reports a storage failure as a blocker instead of throwing', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]), count },
      masterCatalogueItem: { count },
      finishedGoodQr: { count },
      finishedGood: { count },
      productionOutput: { count },
      stockTransaction: { count },
      productionRequestItem: { count },
      productionRequest: { count },
      batch: { count },
      qrCode: { count },
      material: { count },
      pOLineItem: { count },
      purchaseOrder: { count },
      auditLog: { count },
      setting: { count },
    };
    const storage = { healthCheck: jest.fn().mockRejectedValue(new Error('boom')) };
    const svc = new HandoverService(prisma as never, storage as never);
    const res = await svc.readiness();
    expect(res.storage.ok).toBe(false);
    expect(res.blockers.join(' ')).toMatch(/storage/i);
  });
});
