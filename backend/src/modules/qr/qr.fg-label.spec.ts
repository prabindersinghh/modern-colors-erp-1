import { PDFDocument } from 'pdf-lib';
import { QrService, type FgQrPayload, type QrPayload } from './qr.service';

/**
 * Regression guard for the finished-goods label roll.
 *
 * BUG THIS LOCKS DOWN: `buildLabelRoll` was written for the raw-material payload
 * and read `payload.materialName` directly. Finished-goods payloads have no such
 * field — they carry `productName` — so every FG label roll threw
 * "Cannot read properties of undefined (reading 'split')" and the endpoint
 * returned a 500. It shipped broken with Phase 3 because the call site cast the
 * payload with `as never`, which silenced the compiler error that would have
 * caught it.
 *
 * Both payload shapes now flow through one renderer, so the 3×1.5in geometry can
 * never drift between them.
 */
describe('QrService.buildLabelRoll — finished-goods payloads', () => {
  const svc = new QrService();

  const fg = (i: number): FgQrPayload => ({
    kind: 'FINISHED_GOOD',
    uniqueId: `FG-${String(i).padStart(6, '0')}`,
    productName: 'PU ENAMEL',
    batch: 'newfirm',
    department: 'PU',
    size: '20 L',
    shade: 'RAL1000',
    productSku: null,
    date: new Date('2026-07-20').toISOString(),
  });

  const mc = (i: number): QrPayload => ({
    uniqueId: `MC-${String(i).padStart(6, '0')}`,
    materialName: 'Titanium Dioxide',
    sku: 'TIO2-001',
    hsnCode: '28230010',
    supplier: 'Deccan Chemicals',
    poNumber: 'PO-2026-0742',
    batch: 'B-001',
    date: new Date('2026-07-01').toISOString(),
  });

  it('builds an FG roll without throwing (the 500 that was reported)', async () => {
    const pdf = await svc.buildLabelRoll([{ payload: fg(4) }, { payload: fg(5) }]);
    expect(pdf.length).toBeGreaterThan(0);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
  }, 30_000);

  it('keeps FG pages at exactly 216 × 108 pt, one label per page', async () => {
    const pdf = await svc.buildLabelRoll(
      Array.from({ length: 5 }, (_, i) => ({ payload: fg(i + 1) })),
    );
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(5);
    for (const page of doc.getPages()) {
      expect([page.getWidth(), page.getHeight()]).toEqual([216, 108]);
    }
  }, 30_000);

  it('renders a mixed roll — both payload shapes share one renderer', async () => {
    const pdf = await svc.buildLabelRoll([{ payload: mc(1) }, { payload: fg(1) }]);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    for (const page of doc.getPages()) {
      expect([page.getWidth(), page.getHeight()]).toEqual([216, 108]);
    }
  }, 30_000);

  it('survives missing optional fields instead of failing the whole run', async () => {
    // These payloads are JSON columns written by earlier releases; one bad row
    // must degrade to a blank line, never take down a 100-label print job.
    const sparse = {
      kind: 'FINISHED_GOOD',
      uniqueId: 'FG-000099',
      productName: 'Unnamed Product',
      batch: null,
      department: null,
      size: null,
      shade: null,
      productSku: null,
      date: 'not-a-date',
    } as FgQrPayload;
    const pdf = await svc.buildLabelRoll([{ payload: sparse }]);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
  }, 30_000);

  // Generous timeout: this encodes 100 real QR PNGs, which is genuinely CPU-bound.
  // It runs in ~3s alone but ~55s when Jest is running suites in parallel on a
  // loaded machine, so the budget is set for the contended case, not the ideal one.
  it('handles a full 100-unit roll, the size that was failing in production', async () => {
    const pdf = await svc.buildLabelRoll(
      Array.from({ length: 100 }, (_, i) => ({ payload: fg(i + 1) })),
    );
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(100);
  }, 180_000);
});
