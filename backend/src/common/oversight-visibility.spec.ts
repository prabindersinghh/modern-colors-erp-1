import { Reflector } from '@nestjs/core';
import { RequestMethod, RequestMethod as RM } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { ROLES_KEY } from './decorators/roles.decorator';
import { ALLOW_CORRECTION_KEY } from './decorators/allow-correction.decorator';
import { ALLOW_USER_ADMIN_KEY } from './decorators/allow-user-admin.decorator';
import { ALLOW_REPRINT_APPROVAL_KEY } from './decorators/allow-reprint-approval.decorator';
import { ALLOW_ACCESS_FLIP_KEY } from './decorators/allow-access-flip.decorator';
import { ScanSessionController } from '../modules/scan-session/scan-session.controller';
import { PackingController } from '../modules/packing/packing.controller';
import { ReceivingSlipController } from '../modules/receiving-slip/receiving-slip.controller';
import { FinishedGoodsController } from '../modules/finished-goods/finished-goods.controller';

/**
 * BUILD 3 — the owner's total-visibility rule: Admin (OVERSIGHT) sees EVERYTHING happening
 * anywhere, READ-ONLY. This sweeps the surfaces these builds added — scan sessions, the
 * packing desk/lists/cartons, and the receiving-slip (GRN) reads — and pins:
 *   1. OVERSIGHT can reach every GET (total visibility),
 *   2. OVERSIGHT can reach NO write (zero new writes), and
 *   3. OVERSIGHT holds NO named door on any of them (the door count stays four; the
 *      four doors are pinned in user-admin.spec.ts).
 */
describe('BUILD 3 — OVERSIGHT total visibility, read-only', () => {
  const reflector = new Reflector();
  const methodsOf = (c: any): string[] =>
    Object.getOwnPropertyNames(c.prototype).filter((m) => m !== 'constructor' && typeof c.prototype[m] === 'function');
  const rolesFor = (c: any, m: string): Role[] | undefined =>
    reflector.getAllAndOverride<Role[]>(ROLES_KEY, [c.prototype[m], c]);
  const verbOf = (c: any, m: string): RequestMethod | undefined =>
    Reflect.getMetadata(METHOD_METADATA, c.prototype[m]);
  const grantsOversight = (c: any, m: string) => (rolesFor(c, m) ?? []).includes(Role.OVERSIGHT);

  // The DATA reads OVERSIGHT must reach on each surface for total visibility. Deliberately
  // NOT every GET: a per-caller state read (scan-session `current` — the caller's OWN open
  // session) and the label-PDF print paths (`labels`, `listLabels` — artifacts guarded by
  // the reprint lock, not data) are excluded, and that exclusion is a visible decision here.
  const SURFACES: [string, any, string[]][] = [
    ['ScanSessionController', ScanSessionController, ['list']],
    ['PackingController', PackingController, ['pool', 'batches', 'batch', 'cartons', 'carton', 'resolve', 'lists', 'packingList']],
    ['ReceivingSlipController', ReceivingSlipController, ['list', 'byPo', 'findOne', 'slipPdf']],
  ];

  describe.each(SURFACES)('%s', (_name, controller, dataReads) => {
    it('OVERSIGHT reaches every DATA read (total visibility)', () => {
      for (const m of dataReads) {
        expect({ method: m, oversight: grantsOversight(controller, m) }).toEqual({ method: m, oversight: true });
      }
    });

    it('OVERSIGHT reaches NO write (zero new writes)', () => {
      for (const m of methodsOf(controller)) {
        const verb = verbOf(controller, m);
        if (verb === undefined || verb === RM.GET) continue;
        expect({ method: m, oversight: grantsOversight(controller, m) }).toEqual({ method: m, oversight: false });
      }
    });

    it('holds NO named door (door count stays four)', () => {
      for (const m of methodsOf(controller)) {
        for (const key of [ALLOW_CORRECTION_KEY, ALLOW_USER_ADMIN_KEY, ALLOW_REPRINT_APPROVAL_KEY, ALLOW_ACCESS_FLIP_KEY]) {
          expect(reflector.getAllAndOverride<boolean>(key, [(controller.prototype as any)[m], controller])).toBeFalsy();
        }
      }
    });
  });

  it('scan-session history is a GET OVERSIGHT can read; start/close stay writes it cannot', () => {
    expect(grantsOversight(ScanSessionController, 'list')).toBe(true);
    expect(verbOf(ScanSessionController, 'list')).toBe(RM.GET);
    for (const w of ['open', 'close']) {
      expect(grantsOversight(ScanSessionController, w)).toBe(false);
    }
  });

  it('the dispatch PG-list cards (GET) are OVERSIGHT-readable', () => {
    for (const m of ['pgLists', 'pgList', 'readyCartons']) {
      expect({ method: m, oversight: grantsOversight(FinishedGoodsController, m) }).toEqual({ method: m, oversight: true });
      expect(verbOf(FinishedGoodsController, m)).toBe(RM.GET);
    }
    // …and OVERSIGHT still writes nothing there (dispatch/return actions stay DISPATCH-only).
    for (const w of ['scan', 'bulk', 'scanCarton', 'scrapReturn', 'refurbishReturn']) {
      expect(grantsOversight(FinishedGoodsController, w)).toBe(false);
    }
  });
});
