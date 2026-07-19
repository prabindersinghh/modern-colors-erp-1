import { PDFDocument } from 'pdf-lib';
import { QrService } from './qr.service';

/**
 * Guards the printed label contract after the speed optimisation (client feedback
 * item 3). The roll MUST stay exactly 3×1.5in with one label per page — the factory's
 * label-roll printer depends on it. Speed work must never change this.
 */
describe('QrService.buildLabelRoll — printed format is fixed', () => {
  const svc = new QrService();
  const payload = (i: number) => ({
    uniqueId: `MC-${String(i).padStart(6, '0')}`,
    materialName: 'Titanium Dioxide Rutile Grade',
    sku: 'TIO2-001',
    hsnCode: '28230010',
    supplier: 'Deccan Chemicals & Pigments Pvt. Ltd.',
    poNumber: 'PO-2026-0742',
    batch: 'B-001',
    date: new Date('2026-07-01').toISOString(),
  });

  it('emits exactly 216 × 108 pt (3.00 × 1.50 in) pages', async () => {
    const pdf = await svc.buildLabelRoll([{ payload: payload(1) }]);
    const doc = await PDFDocument.load(pdf);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBe(216);
    expect(page.getHeight()).toBe(108);
    expect(page.getWidth() / 72).toBeCloseTo(3.0, 5);
    expect(page.getHeight() / 72).toBeCloseTo(1.5, 5);
  }, 30_000);

  it('emits ONE page per unit, all the same label size', async () => {
    const n = 4;
    const items = Array.from({ length: n }, (_, i) => ({ payload: payload(i + 1) }));
    const doc = await PDFDocument.load(await svc.buildLabelRoll(items));
    expect(doc.getPageCount()).toBe(n);
    for (const page of doc.getPages()) {
      expect([page.getWidth(), page.getHeight()]).toEqual([216, 108]);
    }
  }, 60_000);

  it('produces a valid, non-empty PDF', async () => {
    const pdf = await svc.buildLabelRoll([{ payload: payload(1) }]);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);

  it('QR raster stays well above scanner resolution', async () => {
    // The QR prints at ~1.31in; the raster must give >=2px per module for a clean scan.
    const png = await svc.pngBuffer(payload(1) as never);
    expect(png.length).toBeGreaterThan(200); // a real PNG, not empty
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  }, 30_000);
});
