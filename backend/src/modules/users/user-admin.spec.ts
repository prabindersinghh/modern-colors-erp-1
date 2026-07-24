import { Reflector } from '@nestjs/core';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ALLOW_CORRECTION_KEY } from '../../common/decorators/allow-correction.decorator';
import { ALLOW_USER_ADMIN_KEY } from '../../common/decorators/allow-user-admin.decorator';
import { ALLOW_REPRINT_APPROVAL_KEY } from '../../common/decorators/allow-reprint-approval.decorator';
import { ALLOW_ACCESS_FLIP_KEY } from '../../common/decorators/allow-access-flip.decorator';
import { UserAdminGuard } from '../../common/guards/user-admin.guard';
import { UserAdminController } from './user-admin.controller';
import { UserAdminService, LOGIN_DOMAIN } from './user-admin.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { FgCorrectionsController } from '../finished-goods/fg-corrections.controller';
import { FinishedGoodsController } from '../finished-goods/finished-goods.controller';
import { MaterialController } from '../material/material.controller';
import { DashboardController } from '../dashboard/dashboard.controller';
import { CatalogueController } from '../catalogue/catalogue.controller';
import { PurchaseOrderController } from '../purchase-order/purchase-order.controller';
import { StockController } from '../stock/stock.controller';
import { ProductionRequestController } from '../production-request/production-request.controller';
import { BatchController } from '../batch/batch.controller';
import { ProductionOutputController } from '../production-output/production-output.controller';
import { AnalyticsController } from '../analytics/analytics.controller';
import { ReceivingController } from '../receiving/receiving.controller';
import {
  LabelReprintController,
  LabelReprintApprovalController,
} from '../label-reprint/label-reprint.controller';
import {
  SystemFlagsController,
  SystemFlagsAdminController,
} from '../system-flags/system-flags.controller';

/**
 * User management is the SECOND named door through OVERSIGHT's view-only rule.
 * Pinned here: the door is narrow, two-sided, escalation-proof, and the complete
 * OVERSIGHT write surface across the app is exactly the two named doors.
 */
const reflector = new Reflector();

const ALL_CONTROLLERS: [string, any][] = [
  ['FinishedGoodsController', FinishedGoodsController],
  ['FgCorrectionsController', FgCorrectionsController],
  ['UserAdminController', UserAdminController],
  ['UsersController', UsersController],
  ['MaterialController', MaterialController],
  ['DashboardController', DashboardController],
  ['CatalogueController', CatalogueController],
  ['PurchaseOrderController', PurchaseOrderController],
  ['StockController', StockController],
  ['ProductionRequestController', ProductionRequestController],
  ['BatchController', BatchController],
  ['ProductionOutputController', ProductionOutputController],
  ['AnalyticsController', AnalyticsController],
  ['ReceivingController', ReceivingController],
  ['LabelReprintController', LabelReprintController],
  ['LabelReprintApprovalController', LabelReprintApprovalController],
  ['SystemFlagsController', SystemFlagsController],
  ['SystemFlagsAdminController', SystemFlagsAdminController],
];

const methodsOf = (c: any): string[] =>
  Object.getOwnPropertyNames(c.prototype).filter(
    (m) => m !== 'constructor' && typeof c.prototype[m] === 'function',
  );
const rolesFor = (c: any, m: string): Role[] | undefined =>
  reflector.getAllAndOverride<Role[]>(ROLES_KEY, [c.prototype[m], c]);
const verbOf = (c: any, m: string): RequestMethod | undefined =>
  Reflect.getMetadata(METHOD_METADATA, c.prototype[m]);

describe('the OVERSIGHT write surface stays exactly two named doors', () => {
  it('OVERSIGHT is still in NO mutating @Roles list anywhere', () => {
    for (const [name, controller] of ALL_CONTROLLERS) {
      for (const m of methodsOf(controller)) {
        const verb = verbOf(controller, m);
        if (verb === undefined || verb === RequestMethod.GET) continue;
        expect({ controller: name, method: m, roles: rolesFor(controller, m) ?? [] }).not.toMatchObject({
          roles: expect.arrayContaining([Role.OVERSIGHT]),
        });
      }
    }
  });

  it('each door marker exists ONLY on its own controller — the complete Oversight write surface', () => {
    const userAdmin: string[] = [];
    const corrections: string[] = [];
    const reprints: string[] = [];
    const flips: string[] = [];
    for (const [name, controller] of ALL_CONTROLLERS) {
      for (const m of methodsOf(controller)) {
        if (reflector.getAllAndOverride<boolean>(ALLOW_USER_ADMIN_KEY, [controller.prototype[m], controller]))
          userAdmin.push(`${name}.${m}`);
        if (reflector.getAllAndOverride<boolean>(ALLOW_CORRECTION_KEY, [controller.prototype[m], controller]))
          corrections.push(`${name}.${m}`);
        if (reflector.getAllAndOverride<boolean>(ALLOW_REPRINT_APPROVAL_KEY, [controller.prototype[m], controller]))
          reprints.push(`${name}.${m}`);
        if (reflector.getAllAndOverride<boolean>(ALLOW_ACCESS_FLIP_KEY, [controller.prototype[m], controller]))
          flips.push(`${name}.${m}`);
      }
    }
    expect(corrections).toEqual(['FgCorrectionsController.correct']);
    // The THIRD door: deciding a label reprint. Approving and rejecting, nothing else —
    // notably NOT printing, which stays with the roles that already had it.
    expect(reprints.sort()).toEqual([
      'LabelReprintApprovalController.approve',
      'LabelReprintApprovalController.reject',
    ]);
    // The FOURTH door: flipping an operational flag. It now governs TWO flag keys —
    // store-inward-access and packing-stage — through the SAME door on the SAME
    // controller, so the door COUNT is still four. A door being ADDED is the pattern
    // working; what must never happen is a marker appearing on a controller NOT listed
    // here. Both handlers live on SystemFlagsAdminController, so the write surface is
    // unchanged: one named door, enumerated.
    expect(flips.sort()).toEqual(['SystemFlagsAdminController.set', 'SystemFlagsAdminController.setPacking']);
    expect(userAdmin.sort()).toEqual([
      'UserAdminController.create',
      'UserAdminController.deactivate',
      'UserAdminController.list',
      'UserAdminController.reactivate',
      'UserAdminController.rename',
      'UserAdminController.resetPassword',
    ]);
  });

  it('the user-admin controller never uses @Roles', () => {
    for (const m of methodsOf(UserAdminController)) {
      expect(rolesFor(UserAdminController, m)).toBeUndefined();
    }
  });
});

describe('UserAdminGuard is two-sided', () => {
  const guard = new UserAdminGuard(reflector);
  const ctx = (handler: unknown, role?: Role) =>
    ({
      getHandler: () => handler,
      getClass: () => UserAdminController,
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    }) as never;
  const marked = UserAdminController.prototype.create;
  const unmarked = function unmarked() {};

  it('refuses an UNMARKED handler even for OVERSIGHT', () => {
    expect(() => guard.canActivate(ctx(unmarked, Role.OVERSIGHT))).toThrow(ForbiddenException);
  });

  it('refuses every role except OVERSIGHT on marked handlers', () => {
    for (const r of [Role.ADMIN, Role.DISPATCH, Role.PRODUCTION_HEAD, Role.OPERATOR, Role.SUPERVISOR]) {
      expect(() => guard.canActivate(ctx(marked, r))).toThrow(ForbiddenException);
    }
  });

  it('passes OVERSIGHT on marked handlers', () => {
    expect(guard.canActivate(ctx(marked, Role.OVERSIGHT))).toBe(true);
  });
});

describe('UserAdminService — creation rules are server-enforced', () => {
  const build = () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'u-new', ...data, passwordHash: undefined })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'u1', email: 'x@moderncolours.local', ...data })),
      },
    };
    const audit = { log: jest.fn() };
    return { svc: new UserAdminService(prisma as never, audit as never), prisma, audit };
  };
  const actor = 'oversight-id';

  it('composes the email server-side — the domain suffix cannot be bypassed', async () => {
    const { svc, prisma } = build();
    await svc.create(actor, { localPart: 'PU2', name: 'PU night shift', role: 'PRODUCTION_HEAD', department: 'PU', password: 'goodpass1' });
    expect(prisma.user.create.mock.calls[0][0].data.email).toBe(`pu2${LOGIN_DOMAIN}`);
    // Even a smuggled @-suffix in the local part is rejected by the charset rule.
    await expect(
      svc.create(actor, { localPart: 'evil@gmail.com', name: 'x', role: 'DISPATCH', password: 'goodpass1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('NO escalation: the PRIVILEGED roles can never be minted', async () => {
    // The creatable set widened for segregation of duties (Gate = OPERATOR, and
    // REVIEWER), but the roles that carry real power stay seed-only. SUPERVISOR is
    // included: it reads the audit log, so minting one is an escalation.
    const { svc } = build();
    for (const role of ['ADMIN', 'OVERSIGHT', 'SUPERVISOR']) {
      await expect(
        svc.create(actor, { localPart: 'x1', name: 'x', role, department: 'PU', password: 'goodpass1' }),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('mints a Gate and a Reviewer, both forced department-less', async () => {
    const { svc, prisma } = build();
    await svc.create(actor, { localPart: 'gate2', name: 'Gate — night', role: 'OPERATOR', department: 'PU', password: 'goodpass1' });
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ role: 'OPERATOR', department: null });
    await svc.create(actor, { localPart: 'auditor', name: 'Auditor', role: 'REVIEWER', department: 'ENAMEL', password: 'goodpass1' });
    expect(prisma.user.create.mock.calls[1][0].data).toMatchObject({ role: 'REVIEWER', department: null });
  });

  it('refuses to deactivate the LAST active Gate — the factory could not receive at all', async () => {
    const { svc, prisma } = build();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'g1', email: 'gate@moderncolours.local', role: Role.OPERATOR, active: true });
    prisma.user.count.mockResolvedValueOnce(1);
    await expect(svc.deactivate(actor, 'g1')).rejects.toThrow(/only active Gate login/);
  });

  it('ALLOWS deactivating a Gate once a second one exists', async () => {
    const { svc, prisma } = build();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'g1', email: 'gate@moderncolours.local', role: Role.OPERATOR, active: true });
    prisma.user.count.mockResolvedValueOnce(2);
    await svc.deactivate(actor, 'g1');
    expect(prisma.user.update.mock.calls.at(-1)![0].data).toEqual({ active: false });
  });

  it('a head requires a department; a Dispatch login is department-less by force', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.create(actor, { localPart: 'pu9', name: 'x', role: 'PRODUCTION_HEAD', password: 'goodpass1' }),
    ).rejects.toThrow(/needs a department/);
    await svc.create(actor, { localPart: 'dispatch2', name: 'x', role: 'DISPATCH', department: 'PU', password: 'goodpass1' });
    expect(prisma.user.create.mock.calls[0][0].data.department).toBeNull();
  });

  it('rejects weak passwords and the published default', async () => {
    const { svc } = build();
    for (const pw of ['short1', 'onlyletters', '12345678', 'ChangeMe123!']) {
      await expect(
        svc.create(actor, { localPart: 'pu2', name: 'x', role: 'DISPATCH', password: pw }),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('audits creation WITHOUT the password (or hash)', async () => {
    const { svc, audit } = build();
    await svc.create(actor, { localPart: 'pu2', name: 'x', role: 'PRODUCTION_HEAD', department: 'PU', password: 'goodpass1' });
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('USER_CREATED');
    expect(entry.actorId).toBe(actor);
    expect(JSON.stringify(entry)).not.toContain('goodpass1');
    expect(JSON.stringify(entry)).not.toContain('passwordHash');
  });

  it('deactivation refuses Store and Admin accounts (lockout protection), audits otherwise', async () => {
    const { svc, prisma, audit } = build();
    for (const role of [Role.ADMIN, Role.OVERSIGHT]) {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', email: 'a@moderncolours.local', role, active: true });
      await expect(svc.deactivate(actor, 'u1')).rejects.toThrow(ConflictException);
    }
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u2', email: 'pu2@moderncolours.local', role: Role.PRODUCTION_HEAD, active: true });
    await svc.deactivate(actor, 'u2');
    expect(prisma.user.update.mock.calls.at(-1)![0].data).toEqual({ active: false });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_DEACTIVATED' }));
  });

  it('rename changes the display name only — never identity, role or active state', async () => {
    const { svc, prisma, audit } = build();
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u2', email: 'pu2@moderncolours.local', name: 'PU Head - second shift',
      role: Role.PRODUCTION_HEAD, department: 'PU', active: false,
    });
    await svc.rename(actor, 'u2', '  TEST PU Login - not for production use  ');
    const call = prisma.user.update.mock.calls.at(-1)![0];
    expect(call.data).toEqual({ name: 'TEST PU Login - not for production use' }); // trimmed; nothing else touched
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_RENAMED',
        actorId: actor,
        before: { name: 'PU Head - second shift' },
      }),
    );
    // The protected accounts are unreachable here too — rename goes through getManaged.
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', email: 'admin@moderncolours.local', role: Role.ADMIN, active: true });
    await expect(svc.rename(actor, 'u1', 'x')).rejects.toThrow(ConflictException);
    await expect(svc.rename(actor, 'u2', '   ')).rejects.toThrow(BadRequestException);
  });

  it('list marks which logins came with the system, and never leaks a hash', async () => {
    const { svc, prisma } = build();
    const hash = await bcrypt.hash('ChangeMe123!', 4);
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'a', email: `pu${LOGIN_DOMAIN}`, name: 'PU', role: Role.PRODUCTION_HEAD, department: 'PU', active: true, passwordHash: hash },
      { id: 'b', email: `pu2${LOGIN_DOMAIN}`, name: 'PU2', role: Role.PRODUCTION_HEAD, department: 'PU', active: false, passwordHash: await bcrypt.hash('somethingelse1', 4) },
    ]);
    const rows = await svc.list();
    expect(rows.map((r) => [r.email, r.seeded, r.usingDefaultPassword])).toEqual([
      [`pu${LOGIN_DOMAIN}`, true, true],   // seeded AND still on the published default
      [`pu2${LOGIN_DOMAIN}`, false, false], // the Admin's own login
    ]);
    expect(JSON.stringify(rows)).not.toContain('passwordHash');
    expect(JSON.stringify(rows)).not.toContain('$2');
  });

  it('reactivation restores login and audits', async () => {
    const { svc, prisma, audit } = build();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u2', email: 'pu2@moderncolours.local', role: Role.PRODUCTION_HEAD, active: false });
    await svc.reactivate(actor, 'u2');
    expect(prisma.user.update.mock.calls.at(-1)![0].data).toEqual({ active: true });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_REACTIVATED' }));
  });
});

describe('the pre-existing Store create path is also escalation-proof now', () => {
  it('UsersService.create refuses ADMIN and OVERSIGHT', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() } };
    const svc = new UsersService(prisma as never, { log: jest.fn() } as never);
    for (const role of [Role.ADMIN, Role.OVERSIGHT]) {
      await expect(
        svc.create({ email: 'x@moderncolours.local', name: 'x', role, password: 'goodpass1' } as never, 'store-id'),
      ).rejects.toThrow(ConflictException);
    }
  });
});
