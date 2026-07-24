import { ConflictException } from '@nestjs/common';
import { SlipStatus } from '@prisma/client';
import { ReceivingSlipService } from './receiving-slip.service';

/**
 * Restated after the scan-session gating landed: the receiving slip still FINALIZES on
 * Done, records the physical scanned count, and refuses a double-finalise. The session
 * gate governs whether a SCAN is accepted; it does not touch this slip closing.
 */
describe('receiving slip FINALIZED-on-Done', () => {
  const build = (slip: any) => {
    const prisma = {
      receivingSlip: {
        findUnique: jest.fn(async () => slip),
        update: jest.fn(async ({ data }: any) => ({ ...slip, ...data })),
      },
    };
    const audit = { log: jest.fn() };
    return { svc: new ReceivingSlipService(prisma as never, audit as never), prisma, audit };
  };
  const user = { id: 'store-1', role: 'ADMIN' } as never;

  it('sets FINALIZED, the finaliser and the scanned count, and audits it', async () => {
    const { svc, audit } = build({ id: 's1', slipNumber: 'RS-000009', status: SlipStatus.AWAITING_STORE, unitCount: 16 });
    const res = await svc.finalize(user, 's1', 16);
    expect(res.status).toBe(SlipStatus.FINALIZED);
    expect(res.scannedCount).toBe(16);
    expect(res.finalizedById).toBe('store-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECEIVING_SLIP_FINALIZED', after: expect.objectContaining({ scannedCount: 16 }) }),
    );
  });

  it('refuses to finalise twice', async () => {
    const { svc } = build({ id: 's1', slipNumber: 'RS-000009', status: SlipStatus.FINALIZED, unitCount: 16 });
    await expect(svc.finalize(user, 's1', 16)).rejects.toThrow(ConflictException);
  });
});
