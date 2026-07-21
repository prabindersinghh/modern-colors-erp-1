import { Reflector } from '@nestjs/core';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ALLOW_CORRECTION_KEY } from '../../common/decorators/allow-correction.decorator';
import { CorrectionsGuard } from '../../common/guards/corrections.guard';
import { FgCorrectionsController } from './fg-corrections.controller';
import { FinishedGoodsController } from './finished-goods.controller';
import { FinishedGoodsService } from './finished-goods.service';
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

/**
 * The corrections permission must stay NARROW, and OVERSIGHT's view-only rule must
 * stay STRUCTURAL. Sibling of dispatch-isolation.spec.ts, asserted from live metadata:
 *
 *  1. OVERSIGHT appears in no mutating (non-GET) @Roles list anywhere — the one write
 *     it has goes through @AllowCorrection + CorrectionsGuard, a separate named door.
 *  2. Exactly ONE handler in the app carries that marker.
 *  3. The guard itself is two-sided: unmarked handler → refused even for OVERSIGHT;
 *     marked handler → refused for every role except OVERSIGHT.
 *  4. The service can only touch non-identity fields — uniqueId/status can never
 *     change through a correction, and every correction is audited before→after.
 */
const reflector = new Reflector();

const ALL_CONTROLLERS: [string, any][] = [
  ['FinishedGoodsController', FinishedGoodsController],
  ['FgCorrectionsController', FgCorrectionsController],
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
];

function methodsOf(controller: any): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter(
    (m) => m !== 'constructor' && typeof controller.prototype[m] === 'function',
  );
}
const rolesFor = (controller: any, method: string): Role[] | undefined =>
  reflector.getAllAndOverride<Role[]>(ROLES_KEY, [controller.prototype[method], controller]);
const verbOf = (controller: any, method: string): RequestMethod | undefined =>
  Reflect.getMetadata(METHOD_METADATA, controller.prototype[method]);

describe('OVERSIGHT stays structurally view-only', () => {
  it('appears in NO mutating (non-GET) @Roles list across the app', () => {
    for (const [name, controller] of ALL_CONTROLLERS) {
      for (const m of methodsOf(controller)) {
        const verb = verbOf(controller, m);
        if (verb === undefined || verb === RequestMethod.GET) continue;
        const roles = rolesFor(controller, m) ?? [];
        // Failure message names the exact route that broke the rule.
        expect({ controller: name, method: m, roles }).not.toMatchObject({
          roles: expect.arrayContaining([Role.OVERSIGHT]),
        });
      }
    }
  });

  it('has exactly ONE @AllowCorrection handler in the app — the FG correction route', () => {
    const marked: string[] = [];
    for (const [name, controller] of ALL_CONTROLLERS) {
      for (const m of methodsOf(controller)) {
        const flag = reflector.getAllAndOverride<boolean>(ALLOW_CORRECTION_KEY, [
          controller.prototype[m],
          controller,
        ]);
        if (flag) marked.push(`${name}.${m}`);
      }
    }
    expect(marked).toEqual(['FgCorrectionsController.correct']);
  });

  it('the corrections controller uses its own guard, not @Roles', () => {
    for (const m of methodsOf(FgCorrectionsController)) {
      expect(rolesFor(FgCorrectionsController, m)).toBeUndefined();
    }
  });
});

describe('CorrectionsGuard is two-sided', () => {
  const guard = new CorrectionsGuard(reflector);
  const ctx = (handler: unknown, role?: Role) =>
    ({
      getHandler: () => handler,
      getClass: () => FgCorrectionsController,
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    }) as never;

  const marked = FgCorrectionsController.prototype.correct;
  const unmarked = function unmarked() {};

  it('refuses an UNMARKED handler even for OVERSIGHT — it can never open other routes', () => {
    expect(() => guard.canActivate(ctx(unmarked, Role.OVERSIGHT))).toThrow(ForbiddenException);
  });

  it('refuses every role except OVERSIGHT on the marked handler', () => {
    for (const r of [Role.ADMIN, Role.DISPATCH, Role.PRODUCTION_HEAD, Role.OPERATOR, Role.SUPERVISOR]) {
      expect(() => guard.canActivate(ctx(marked, r))).toThrow(ForbiddenException);
    }
    expect(() => guard.canActivate(ctx(marked, undefined))).toThrow(ForbiddenException);
  });

  it('passes OVERSIGHT on the marked handler', () => {
    expect(guard.canActivate(ctx(marked, Role.OVERSIGHT))).toBe(true);
  });
});

describe('FinishedGoodsService.correct — non-identity fields only, audited', () => {
  const user = { id: 'owner', role: 'OVERSIGHT' } as never;
  const baseUnit = {
    id: 'fg1',
    uniqueId: 'FG-000001',
    productName: 'Weathershield White',
    sizePerPackage: 20,
    sizeUnit: 'L',
    dispatchNote: null,
    batch: { batchNumber: 'PU-B-1', department: 'PU' },
    output: { productionDate: new Date('2026-07-01'), shade: null, productSku: null },
    qrCode: { id: 'qr1' },
  };

  const build = () => {
    const tx = {
      finishedGood: {
        update: jest.fn().mockImplementation(({ data }) => ({ ...baseUnit, ...data })),
      },
      finishedGoodQr: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      finishedGood: { findUnique: jest.fn().mockResolvedValue(baseUnit) },
      $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    };
    const audit = { log: jest.fn() };
    const qr = { dataUrl: jest.fn().mockResolvedValue('data:image/png;base64,x') };
    return { svc: new FinishedGoodsService(prisma as never, audit as never, qr as never), tx, audit };
  };

  it('rejects a correction that changes nothing', async () => {
    const { svc } = build();
    await expect(
      svc.correct(user, 'FG-000001', { productName: 'Weathershield White', note: 'no-op' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('can NEVER touch identity: update data contains no uniqueId and no status', async () => {
    const { svc, tx } = build();
    await svc.correct(user, 'FG-000001', {
      productName: 'Weathershield Brilliant White',
      sizePerPackage: 25,
      dispatchNote: 'left dock 9',
      note: 'name typo + drum size recorded wrong',
    });
    const data = tx.finishedGood.update.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(
      ['dispatchNote', 'productName', 'qrReprintNeeded', 'sizePerPackage'].sort(),
    );
    expect('uniqueId' in data).toBe(false);
    expect('status' in data).toBe(false);
  });

  it('flags a reprint and regenerates the QR ONLY when a printed field changed', async () => {
    // Printed field (size) → flag + payload regeneration.
    const a = build();
    const res = await a.svc.correct(user, 'FG-000001', { sizePerPackage: 25, note: 'size wrong' });
    expect(res.labelReprintNeeded).toBe(true);
    expect(a.tx.finishedGood.update.mock.calls[0][0].data.qrReprintNeeded).toBe(true);
    expect(a.tx.finishedGoodQr.update).toHaveBeenCalled();

    // Non-printed field (dispatch note) → no flag, no QR churn.
    const b = build();
    const res2 = await b.svc.correct(user, 'FG-000001', { dispatchNote: 'gate pass 12', note: 'note fix' });
    expect(res2.labelReprintNeeded).toBe(false);
    expect('qrReprintNeeded' in b.tx.finishedGood.update.mock.calls[0][0].data).toBe(false);
    expect(b.tx.finishedGoodQr.update).not.toHaveBeenCalled();
  });

  it('audits FG_CORRECTED with the before→after of exactly the changed fields + reason', async () => {
    const { svc, audit } = build();
    await svc.correct(user, 'FG-000001', { productName: 'Corrected Name', note: 'typo on entry' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FG_CORRECTED',
        actorId: 'owner',
        before: { productName: 'Weathershield White' },
        after: expect.objectContaining({
          productName: 'Corrected Name',
          reason: 'typo on entry',
          labelReprintNeeded: true,
        }),
      }),
      expect.anything(),
    );
  });
});
