import { QrService, type QrPayload, type FgQrPayload } from './qr.service';

/**
 * Shortening what a QR IMAGE encodes — and the promise that every sticker already stuck
 * on a sack keeps scanning forever.
 *
 * New labels encode the bare unique id. Old labels, out in the factory today, encode the
 * full JSON payload. Both must resolve to the same id at the scanner for as long as those
 * old stickers physically exist — which is forever. This spec pins both halves so a future
 * edit cannot quietly break decade-old drums.
 */

// The EXACT shapes the services burned into stickers before this change — copied from
// material.service.ts and finished-goods.service.ts, kept here as immovable fixtures.
const OLD_MC_PAYLOAD: QrPayload = {
  uniqueId: 'MC-000123',
  materialName: 'Titanium Dioxide',
  sku: 'TIO2-001',
  hsnCode: '28230010',
  supplier: 'Deccan Chemicals & Pigments Pvt. Ltd.',
  poNumber: 'PO-2026-0742',
  batch: null,
  date: '2026-07-01T00:00:00.000Z',
};
const OLD_FG_PAYLOAD: FgQrPayload = {
  uniqueId: 'FG-000045',
  productName: 'Premium Enamel White',
  batch: 'B-0007',
  department: 'ENAMEL',
  size: '20 L',
  shade: 'RAL 9010',
  productSku: 'PEW-20',
  date: '2026-07-10T00:00:00.000Z',
  kind: 'FINISHED_GOOD',
};

/**
 * The scanner's resolver, byte-for-byte as the frontend implements it
 * (StockPage.tsx `extractUniqueId`): JSON → o.uniqueId, else the raw string.
 * Reproduced here so the guarantee is tested where the fixtures live.
 */
function extractUniqueId(text: string): string {
  try {
    const o = JSON.parse(text);
    if (o && typeof o.uniqueId === 'string') return o.uniqueId;
  } catch {
    /* not JSON */
  }
  return text.trim();
}

describe('a new QR image encodes only the unique id', () => {
  it('MC: the burned content is the bare id, not the JSON', () => {
    expect(QrService.qrContent(OLD_MC_PAYLOAD)).toBe('MC-000123');
  });

  it('FG: the burned content is the bare id, not the JSON', () => {
    expect(QrService.qrContent(OLD_FG_PAYLOAD)).toBe('FG-000045');
  });

  it('falls back to JSON only if a payload somehow lacks an id (never a blank QR)', () => {
    const broken = { materialName: 'x' } as unknown as QrPayload;
    expect(QrService.qrContent(broken)).toBe(JSON.stringify(broken));
  });

  it('the short content is dramatically smaller than the old JSON', () => {
    const short = QrService.qrContent(OLD_MC_PAYLOAD);
    const old = JSON.stringify(OLD_MC_PAYLOAD);
    expect(short.length).toBeLessThan(15);
    expect(old.length).toBeGreaterThan(120);
  });
});

describe('every OLD sticker still resolves — permanently', () => {
  it('an old full-JSON MC sticker resolves to its id', () => {
    const oldStickerContent = JSON.stringify(OLD_MC_PAYLOAD);
    expect(extractUniqueId(oldStickerContent)).toBe('MC-000123');
  });

  it('an old full-JSON FG sticker resolves to its id', () => {
    const oldStickerContent = JSON.stringify(OLD_FG_PAYLOAD);
    expect(extractUniqueId(oldStickerContent)).toBe('FG-000045');
  });

  it('a NEW short sticker resolves to the same id', () => {
    expect(extractUniqueId('MC-000123')).toBe('MC-000123');
    expect(extractUniqueId('FG-000045')).toBe('FG-000045');
  });

  it('old and new stickers for the same unit resolve identically', () => {
    const oldSticker = JSON.stringify(OLD_MC_PAYLOAD);
    const newSticker = QrService.qrContent(OLD_MC_PAYLOAD);
    expect(extractUniqueId(oldSticker)).toBe(extractUniqueId(newSticker));
  });
});

describe('the render pipeline depends ONLY on the unique id', () => {
  const svc = new QrService();

  // Two payloads for the same unit, differing in every OTHER field. If the image were
  // built from the JSON they would differ; because it is built from the id alone, they
  // are identical. This is deterministic within a run (same input string → same bytes)
  // and does not depend on the qrcode library's exact output, so it is not flaky.
  const variantA: QrPayload = { ...OLD_MC_PAYLOAD, materialName: 'A', supplier: 'Supplier One' };
  const variantB: QrPayload = { ...OLD_MC_PAYLOAD, materialName: 'B', supplier: 'Supplier Two' };

  // pngBuffer (toBuffer) is deterministic for identical input; toDataURL is NOT
  // byte-stable across calls (its PNG encoder varies), so it is not asserted here — the
  // qrContent tests above already prove dataUrl's input is the id, and toDataURL shares
  // that exact input. Testing library determinism would only add flakiness.
  it('pngBuffer of the same id is identical regardless of the other fields', async () => {
    const [a, b] = await Promise.all([svc.pngBuffer(variantA), svc.pngBuffer(variantB)]);
    expect(a.equals(b)).toBe(true);
  });

  it('a DIFFERENT id produces a different image — the id really is the content', async () => {
    const [mc, fg] = await Promise.all([svc.pngBuffer(OLD_MC_PAYLOAD), svc.pngBuffer(OLD_FG_PAYLOAD)]);
    expect(mc.equals(fg)).toBe(false);
  });
});
