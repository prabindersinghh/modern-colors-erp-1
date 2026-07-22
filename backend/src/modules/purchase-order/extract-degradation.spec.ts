import { PurchaseOrderService } from './purchase-order.service';

/**
 * Graceful degradation when file storage is unavailable.
 *
 * Invariant I7 says the operator is never blocked: if the invoice cannot be read
 * automatically they fall back to typing it in. That held for AI failures but NOT for
 * storage failures — a storage read error threw a 400, which:
 *   - discarded the specific cause the storage layer had already worked out,
 *   - implied "your request was malformed, do not retry", when retrying after storage
 *     recovers is exactly the right action, and
 *   - gave the operator a dead end instead of the manual-entry route.
 *
 * Both failure modes now return the same { fallback: true } signal the frontend
 * already knows how to handle.
 */
describe('PurchaseOrderService.extract — storage degradation', () => {
  const po = {
    id: 'po-1',
    fileKey: 'po/abc.pdf',
    fileName: 'invoice.pdf',
  };

  const build = (storageError: Error) => {
    const prisma = {
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue(po),
        update: jest.fn(),
      },
    };
    const storage = { get: jest.fn().mockRejectedValue(storageError) };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const extraction = { extract: jest.fn() };
    // Order must match the real constructor:
    // prisma, storage, audit, catalogue, extraction, material, slips
    const svc = new PurchaseOrderService(
      prisma as never,
      storage as never,
      audit as never,
      { match: jest.fn() } as never,
      extraction as never,
      { registerUnits: jest.fn() } as never,
      // Slip generation happens on confirm; extraction never reaches it.
      { generateForConfirm: jest.fn() } as never,
    );
    return { svc, prisma, storage, audit, extraction };
  };

  it('routes the operator to manual entry instead of throwing', async () => {
    const { svc } = build(new Error('file storage is unavailable: the R2 API token is wrong'));
    const res = await svc.extract('po-1', 'user-1');
    expect(res).toMatchObject({ fallback: true, reason: 'storage_unavailable' });
  });

  it('preserves the specific cause the storage layer determined', async () => {
    const { svc } = build(
      new Error(
        'Could not read the document — file storage is unavailable: the storage access token is wrong, expired, or lacks read/write permission.',
      ),
    );
    const res = (await svc.extract('po-1', 'user-1')) as { message?: string };
    // The old generic "could not be read from storage" wording threw away the cause.
    // The cause is kept; infrastructure identifiers are stripped upstream in
    // StorageService (this message is persisted to the audit log verbatim).
    expect(res.message).toMatch(/access token/i);
  });

  it('never calls the AI when the document could not be fetched', async () => {
    const { svc, extraction } = build(new Error('storage down'));
    await svc.extract('po-1', 'user-1');
    // Sending an empty/undefined buffer to the model would waste a paid call.
    expect(extraction.extract).not.toHaveBeenCalled();
  });

  it('records the failure in the audit trail', async () => {
    const { svc, audit } = build(new Error('storage down'));
    await svc.extract('po-1', 'user-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AI_EXTRACTION_FAILED',
        after: expect.objectContaining({ reason: 'storage_unavailable' }),
      }),
    );
  });

  it('does not mark the invoice as extracted', async () => {
    const { svc, prisma } = build(new Error('storage down'));
    await svc.extract('po-1', 'user-1');
    // Nothing was read, so the PO must stay in its pre-extraction state.
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });
});
