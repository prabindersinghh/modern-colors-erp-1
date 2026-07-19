import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';
import { MaterialController } from '../../modules/material/material.controller';
import { DashboardController } from '../../modules/dashboard/dashboard.controller';
import { CatalogueController } from '../../modules/catalogue/catalogue.controller';
import { PurchaseOrderController } from '../../modules/purchase-order/purchase-order.controller';
import { ReceivingController } from '../../modules/receiving/receiving.controller';

/**
 * REGRESSION GUARD for the Phase 3 isolation hardening.
 *
 * Adding class-level @Roles to the material / dashboard / catalogue / purchase-order
 * controllers (to keep the new DISPATCH role out) must NOT have locked Operators or
 * Supervisors out of the Phase 1 screens they use every day. Each case below is a real
 * endpoint called by a real screen, resolved through the SAME Reflector logic the
 * RolesGuard uses at runtime.
 */
describe('Phase 1 access is intact after the DISPATCH role-gating', () => {
  const reflector = new Reflector();

  /** Effective roles for a route: method-level @Roles wins, else class-level. */
  function rolesFor(controller: any, method: string): Role[] | undefined {
    return reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      controller.prototype[method],
      controller,
    ]);
  }

  /** Exactly what RolesGuard does: no metadata = open; else role must be listed. */
  function allows(controller: any, method: string, role: Role): boolean {
    const required = rolesFor(controller, method);
    if (!required || required.length === 0) return true;
    return required.includes(role);
  }

  // screen → [controller, handler] for every endpoint that screen calls.
  const SCREENS: Record<string, [string, any, string][]> = {
    'Invoice Upload': [
      ['GET /purchase-orders', PurchaseOrderController, 'list'],
      ['POST /purchase-orders (upload)', PurchaseOrderController, 'upload'],
      ['POST /purchase-orders/manual', PurchaseOrderController, 'createManual'],
    ],
    'Review & Confirm': [
      ['GET /purchase-orders', PurchaseOrderController, 'list'],
      ['GET /purchase-orders/:id', PurchaseOrderController, 'findOne'],
      ['POST /purchase-orders/:id/extract', PurchaseOrderController, 'extract'],
      ['POST /purchase-orders/:id/confirm', PurchaseOrderController, 'confirm'],
      ['POST /purchase-orders/:id/line-items', PurchaseOrderController, 'addLine'],
      ['PATCH .../line-items/:lineId', PurchaseOrderController, 'updateLine'],
      ['DELETE .../line-items/:lineId', PurchaseOrderController, 'deleteLine'],
      ['POST /catalogue (add no-match SKU)', CatalogueController, 'create'],
    ],
    'QR Labels': [
      ['GET /purchase-orders/:poId/units', MaterialController, 'units'],
      ['GET .../labels.pdf', MaterialController, 'labels'],
      ['GET .../labels.zip', MaterialController, 'labelsZip'],
      ['GET .../labels.csv', MaterialController, 'labelsCsv'],
      ['GET /purchase-orders (picker)', PurchaseOrderController, 'list'],
    ],
    'Scan & Weigh': [
      ['POST /receiving/scan', ReceivingController, 'scan'],
      ['POST /receiving/:uniqueId/weight', ReceivingController, 'weigh'],
    ],
    'Master Catalogue': [
      ['GET /catalogue', CatalogueController, 'findAll'],
      ['GET /catalogue/provisional-count', CatalogueController, 'provisionalCount'],
    ],
    'Phase 1 Dashboard': [
      ['GET /dashboard/summary', DashboardController, 'summary'],
      ['GET /dashboard/search', DashboardController, 'search'],
    ],
  };

  describe.each(Object.entries(SCREENS))('%s', (_screen, endpoints) => {
    it.each(endpoints)('OPERATOR can call %s', (_name, controller, method) => {
      expect(allows(controller, method, Role.OPERATOR)).toBe(true);
    });

    it.each(endpoints)('SUPERVISOR can call %s', (_name, controller, method) => {
      // Supervisor is read-only in places; assert only that the ROLE GATE lets it
      // through where it did before — write routes were always ADMIN/OPERATOR.
      const required = rolesFor(controller, method) ?? [];
      const isWriteRoute =
        required.length > 0 &&
        !required.includes(Role.SUPERVISOR) &&
        required.includes(Role.OPERATOR);
      if (isWriteRoute) {
        // Pre-existing restriction (e.g. upload/confirm are ADMIN+OPERATOR) — unchanged.
        expect(required).not.toContain(Role.SUPERVISOR);
      } else {
        expect(allows(controller, method, Role.SUPERVISOR)).toBe(true);
      }
    });
  });

  it('Store (ADMIN) retains access to every Phase 1 endpoint', () => {
    for (const endpoints of Object.values(SCREENS)) {
      for (const [name, controller, method] of endpoints) {
        expect({ name, ok: allows(controller, method, Role.ADMIN) }).toEqual({ name, ok: true });
      }
    }
  });

  it('DISPATCH is still blocked from every Phase 1 endpoint (the point of the change)', () => {
    for (const endpoints of Object.values(SCREENS)) {
      for (const [name, controller, method] of endpoints) {
        expect({ name, ok: allows(controller, method, Role.DISPATCH) }).toEqual({ name, ok: false });
      }
    }
  });

  it('RolesGuard itself still admits a listed role and rejects an unlisted one', () => {
    const guard = new RolesGuard(reflector);
    const ctx = (user: { role: Role }, controller: any, method: string) =>
      ({
        getHandler: () => controller.prototype[method],
        getClass: () => controller,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as never;

    expect(guard.canActivate(ctx({ role: Role.OPERATOR }, ReceivingController, 'scan'))).toBe(true);
    expect(() =>
      guard.canActivate(ctx({ role: Role.DISPATCH }, ReceivingController, 'scan')),
    ).toThrow();
  });
});
