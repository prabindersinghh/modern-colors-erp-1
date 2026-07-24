import { BadRequestException } from '@nestjs/common';
import { POStatus, SlipStatus } from '@prisma/client';
import { PurchaseOrderService } from './purchase-order.service';

/**
 * BUILD 2 — the minting act (invariant I1) relocated from Store's confirm to GATE'S
 * hand-over. Units NEVER persist without an explicit human confirm; that human is now
 * Gate. Store's `confirm` became an ACCEPT that does NOT mint.
 *
 * Pinned at the service so the relocation cannot silently drift back. Route-level roles
 * are pinned in phase1-access.spec.ts (Gate reaches send-to-store; confirm stays ADMIN).
 */
describe('Build 2 — Gate mints at hand-over; Store accepts (no mint)', () => {
  const buildPo = (status: POStatus, lines = [{ quantity: 2 }, { quantity: 1 }]) => ({
    id: 'po1', status, poNumber: 'PO-1', lineItems: lines,
  });

  const build = (poRow: any, slipRow: any = { status: SlipStatus.DRAFT }) => {
    const registerUnits = jest.fn(async () => [{ uniqueId: 'MC-000001' }, { uniqueId: 'MC-000002' }, { uniqueId: 'MC-000003' }]);
    const attachUnits = jest.fn(async () => ({}));
    const tx: any = {
      purchaseOrder: { update: jest.fn(async () => ({})) },
      receivingSlip: { update: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma: any = {
      purchaseOrder: { findUnique: jest.fn(async () => poRow) },
      receivingSlip: { findUnique: jest.fn(async () => slipRow), updateMany: jest.fn(async () => ({ count: 1 })) },
      $transaction: (fn: any) => fn(tx),
    };
    const audit = { log: jest.fn() };
    const material = { registerUnits };
    const slips = { attachUnits };
    const svc = new PurchaseOrderService(
      prisma, {} as never, audit as never, {} as never, {} as never, material as never, slips as never,
    );
    // findOne is called at the end; stub it to avoid a second DB shape.
    jest.spyOn(svc, 'findOne').mockResolvedValue({ id: 'po1' } as never);
    return { svc, registerUnits, attachUnits, tx, audit };
  };

  describe('handOverToStore (Gate)', () => {
    it('MINTS: registers units, attaches ranges, hands the slip to Store', async () => {
      const { svc, registerUnits, attachUnits, tx } = build(buildPo(POStatus.AI_EXTRACTED));
      const res = await svc.handOverToStore('gate-1', 'po1');
      expect(registerUnits).toHaveBeenCalledTimes(1); // THE MINT
      expect(attachUnits).toHaveBeenCalledTimes(1); // ranges onto the slip
      // slip → AWAITING_STORE (handed over) and PO → REGISTERED
      expect(tx.receivingSlip.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: SlipStatus.AWAITING_STORE }) }),
      );
      expect(res.registeredUnits).toBe(3);
    });

    it('refuses to hand over an un-extracted invoice (needs a human proofread first)', async () => {
      const { svc, registerUnits } = build(buildPo(POStatus.PO_UPLOADED));
      await expect(svc.handOverToStore('gate-1', 'po1')).rejects.toThrow(BadRequestException);
      expect(registerUnits).not.toHaveBeenCalled(); // never mints without the human act
    });

    it('refuses to hand over one already handed over', async () => {
      const { svc } = build(buildPo(POStatus.AI_EXTRACTED), { status: SlipStatus.AWAITING_STORE });
      await expect(svc.handOverToStore('gate-1', 'po1')).rejects.toThrow(/already been handed/);
    });
  });

  describe('accept (Store)', () => {
    it('does NOT mint — only records acceptance of already-registered goods', async () => {
      const { svc, registerUnits, audit } = build(buildPo(POStatus.REGISTERED));
      await svc.accept('po1', 'store-1');
      expect(registerUnits).not.toHaveBeenCalled(); // Store never mints now
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'STORE_INWARD_ACCEPTED' }));
    });

    it('refuses to accept before Gate has handed over / registered', async () => {
      const { svc } = build(buildPo(POStatus.AI_EXTRACTED));
      await expect(svc.accept('po1', 'store-1')).rejects.toThrow(/not been handed over/);
    });
  });
});
