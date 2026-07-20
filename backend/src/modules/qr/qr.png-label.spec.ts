import JSZip from 'jszip';
import Jimp from 'jimp';
import { QrService, type QrPayload, type FgQrPayload } from './qr.service';

/**
 * The "Individual PNGs" export must be a READABLE label, not a bare QR square.
 *
 * The bug: buildLabelsZip encoded only the QR, so a downloaded MC-000351.png showed a
 * scannable code but none of the human-readable fields the PDF prints. These tests pin
 * that each PNG is now a full label (QR + text) at the fixed raster size, for both the
 * raw-material and finished-goods payload shapes, and that the export still names one
 * file per unit.
 */
describe('QrService.labelPngBuffer / buildLabelsZip — individual PNGs carry the info', () => {
  const svc = new QrService();

  const raw = (i: number): QrPayload => ({
    uniqueId: `MC-${String(i).padStart(6, '0')}`,
    materialName: 'Titanium Dioxide Rutile Grade',
    sku: 'TIO2-001',
    hsnCode: '28230010',
    supplier: 'Deccan Chemicals & Pigments Pvt. Ltd.',
    poNumber: 'PO-2026-0742',
    batch: 'B-001',
    date: new Date('2026-07-01').toISOString(),
  });

  const fg = (i: number): FgQrPayload => ({
    kind: 'FINISHED_GOOD',
    uniqueId: `FG-${String(i).padStart(6, '0')}`,
    productName: 'Weathershield Exterior White',
    batch: 'PU-B-014',
    department: 'PU',
    size: '20 L',
    shade: 'RAL 9010',
    productSku: 'WS-EXT-WHT-20',
    date: new Date('2026-07-20').toISOString(),
  });

  it('renders a raw-material label PNG at the fixed raster size', async () => {
    const png = await svc.labelPngBuffer(raw(351));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const img = await Jimp.read(png);
    // 2:1 like the physical 3×1.5in sticker — and NOT the square bare QR.
    expect(img.getWidth()).toBe(600);
    expect(img.getHeight()).toBe(300);
  }, 30_000);

  it('renders a finished-goods label PNG too (different payload shape)', async () => {
    const png = await svc.labelPngBuffer(fg(1));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const img = await Jimp.read(png);
    expect(img.getWidth()).toBe(600);
    expect(img.getHeight()).toBe(300);
  }, 30_000);

  it('carries more pixels of ink than a bare QR (the printed text is really there)', async () => {
    // A bare QR square is 256×256 and pure QR; the label is 600×300 with QR + text. The
    // clearest signal that text was drawn is that the label has dark pixels OUTSIDE the
    // QR block on the left — i.e. in the right-hand text column.
    const png = await svc.labelPngBuffer(raw(351));
    const img = await Jimp.read(png);
    let inkInTextColumn = 0;
    img.scan(320, 0, 260, img.getHeight(), function (_x, _y, idx) {
      // dark pixel = printed glyph
      if (this.bitmap.data[idx] < 128) inkInTextColumn++;
    });
    expect(inkInTextColumn).toBeGreaterThan(50);
  }, 30_000);

  it('bundles one PNG per unit, named by unique ID', async () => {
    const items = [{ payload: raw(1) }, { payload: raw(2) }, { payload: fg(3) }];
    const zipBuf = await svc.buildLabelsZip(items);
    const zip = await JSZip.loadAsync(zipBuf);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(['FG-000003.png', 'MC-000001.png', 'MC-000002.png']);

    // Every entry is a valid, full-size label PNG.
    for (const name of names) {
      const buf = await zip.files[name].async('nodebuffer');
      expect(buf.subarray(1, 4).toString()).toBe('PNG');
      const img = await Jimp.read(buf);
      expect(img.getWidth()).toBe(600);
      expect(img.getHeight()).toBe(300);
    }
  }, 60_000);

  it('falls back to a bare QR PNG if label rendering throws (export never breaks)', async () => {
    // Simulate the image library failing mid-render. The ZIP must still contain a valid
    // PNG for the unit rather than 500 — the guarantee that keeps the live export safe.
    const spy = jest
      .spyOn(svc, 'labelPngBuffer')
      .mockRejectedValueOnce(new Error('image library unavailable'));
    const zip = await JSZip.loadAsync(await svc.buildLabelsZip([{ payload: raw(9) }]));
    const buf = await zip.files['MC-000009.png'].async('nodebuffer');
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    spy.mockRestore();
  }, 30_000);
});
