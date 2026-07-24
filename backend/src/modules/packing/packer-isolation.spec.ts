import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ALLOW_CORRECTION_KEY } from '../../common/decorators/allow-correction.decorator';
import { ALLOW_USER_ADMIN_KEY } from '../../common/decorators/allow-user-admin.decorator';
import { ALLOW_REPRINT_APPROVAL_KEY } from '../../common/decorators/allow-reprint-approval.decorator';
import { ALLOW_ACCESS_FLIP_KEY } from '../../common/decorators/allow-access-flip.decorator';
import { PackingController } from './packing.controller';
import { MaterialController } from '../material/material.controller';
import { StockController } from '../stock/stock.controller';
import { ProductionRequestController } from '../production-request/production-request.controller';
import { BatchController } from '../batch/batch.controller';
import { ProductionOutputController } from '../production-output/production-output.controller';
import { PurchaseOrderController } from '../purchase-order/purchase-order.controller';
import { CatalogueController } from '../catalogue/catalogue.controller';
import { AnalyticsController } from '../analytics/analytics.controller';
import { UserAdminController } from '../users/user-admin.controller';

/**
 * PACKER role isolation, asserted from the actual @Roles metadata.
 *
 * The packer reaches the packing surface ONLY — never raw material, stock, requests,
 * batches, production output, invoices, catalogue, analytics or user admin — and holds
 * NO named door. Modelled on the DISPATCH and REVIEWER isolation sweeps.
 */
describe('PACKER role isolation (server-side)', () => {
  const reflector = new Reflector();
  const rolesFor = (c: any, m: string): Role[] | undefined =>
    reflector.getAllAndOverride<Role[]>(ROLES_KEY, [c.prototype[m], c]);
  const methodsOf = (c: any): string[] =>
    Object.getOwnPropertyNames(c.prototype).filter((m) => m !== 'constructor' && typeof c.prototype[m] === 'function');

  const FORBIDDEN: [string, any][] = [
    ['MaterialController', MaterialController],
    ['StockController', StockController],
    ['ProductionRequestController', ProductionRequestController],
    ['BatchController', BatchController],
    ['ProductionOutputController', ProductionOutputController],
    ['PurchaseOrderController', PurchaseOrderController],
    ['CatalogueController', CatalogueController],
    ['AnalyticsController', AnalyticsController],
    ['UserAdminController', UserAdminController],
  ];

  describe.each(FORBIDDEN)('%s', (_name, controller) => {
    it('never grants PACKER', () => {
      for (const m of methodsOf(controller)) {
        expect(rolesFor(controller, m) ?? []).not.toContain(Role.PACKER);
      }
    });
  });

  describe('PackingController', () => {
    it('gates every route with @Roles', () => {
      for (const m of methodsOf(PackingController)) {
        const roles = rolesFor(PackingController, m);
        expect(roles && roles.length > 0).toBe(true);
      }
    });

    it('restricts the packing ACTIONS to PACKER only', () => {
      for (const m of [
        'scanIn', 'createCarton', 'addItem', 'removeItem', 'confirm', 'voidCarton', 'markPacked',
        'createList', 'addEntry', 'removeEntry', 'confirmList',
      ]) {
        expect(rolesFor(PackingController, m)).toEqual([Role.PACKER]);
      }
    });

    it('lets PACKER read the pool, batch cards, his cartons, lists and resolve a PG', () => {
      for (const m of ['pool', 'batches', 'batch', 'cartons', 'carton', 'resolve', 'lists', 'packingList']) {
        expect(rolesFor(PackingController, m)).toContain(Role.PACKER);
      }
    });

    it('lets OVERSIGHT read every packing GET (total visibility), and write nothing', () => {
      const reads = ['pool', 'batches', 'batch', 'cartons', 'carton', 'resolve', 'lists', 'packingList'];
      for (const m of reads) expect(rolesFor(PackingController, m)).toContain(Role.OVERSIGHT);
      const writes = ['scanIn', 'createCarton', 'addItem', 'removeItem', 'confirm', 'voidCarton', 'markPacked', 'createList', 'addEntry', 'removeEntry', 'confirmList'];
      for (const m of writes) expect(rolesFor(PackingController, m)).not.toContain(Role.OVERSIGHT);
    });

    it('holds NO named door (corrections, user-admin, reprint-approval, access-flip)', () => {
      for (const m of methodsOf(PackingController)) {
        for (const key of [ALLOW_CORRECTION_KEY, ALLOW_USER_ADMIN_KEY, ALLOW_REPRINT_APPROVAL_KEY, ALLOW_ACCESS_FLIP_KEY]) {
          expect(reflector.getAllAndOverride<boolean>(key, [(PackingController.prototype as any)[m], PackingController])).toBeFalsy();
        }
      }
    });
  });
});
