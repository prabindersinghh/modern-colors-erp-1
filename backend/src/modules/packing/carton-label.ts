import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';

/**
 * The carton (packed-goods) mega label — a SECOND fixed format, deliberately NOT the
 * 216×108pt unit sticker (buildLabelRoll), whose geometry is invariant. A carton lists
 * many unit ids and one scannable mega QR, which does not fit a small sticker, so this is
 * A5 and prints on a plain A4 office printer (A5-on-A4 is acceptable). Its own renderer,
 * like slip-pdf.ts — buildLabelRoll is never touched.
 *
 * The QR encodes ONLY the PG id (same short-payload rule as unit QRs): a scan resolves the
 * carton server-side to its exact contents.
 */
export interface CartonLabelDoc {
  uniqueId: string; // PG-000001
  packedAt: Date | null;
  packedBy?: string | null;
  items: Array<{
    uniqueId: string;
    productName: string;
    family: string;
    size: string | null;
    batchNumber: string | null;
  }>;
}

const A5 = { w: 419.53, h: 595.28 }; // A5 portrait
const M = 36;

const familyLabel: Record<string, string> = {
  FINISHED_GOOD: 'Paint',
  HARDENER: 'Hardener',
  THINNER: 'Thinner',
};

export async function buildCartonLabel(doc: CartonLabelDoc): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([A5.w, A5.h]);
  let y = A5.h - M;

  // ── header: PG id + mega QR ──
  page.drawText('PACKED GOODS', { x: M, y, size: 12, font: bold, color: rgb(0.45, 0.45, 0.45) });
  y -= 26;
  page.drawText(doc.uniqueId, { x: M, y, size: 22, font: bold, color: rgb(0.1, 0.1, 0.1) });

  // Mega QR (top-right), encoding just the PG id.
  const qrPng = await QRCode.toBuffer(doc.uniqueId, { type: 'png', width: 256, margin: 1 });
  const qrImg = await pdf.embedPng(qrPng);
  const qrSize = 120;
  page.drawImage(qrImg, { x: A5.w - M - qrSize, y: A5.h - M - qrSize, width: qrSize, height: qrSize });

  y -= 20;
  const meta = `${doc.items.length} unit${doc.items.length === 1 ? '' : 's'}` +
    (doc.packedAt ? ` · packed ${doc.packedAt.toISOString().slice(0, 10)}` : '') +
    (doc.packedBy ? ` · ${doc.packedBy}` : '');
  page.drawText(meta, { x: M, y, size: 9, font, color: rgb(0.45, 0.45, 0.45) });
  y -= 18;

  page.drawLine({ start: { x: M, y }, end: { x: A5.w - M, y }, thickness: 1.2, color: rgb(0.92, 0.0, 0.008) });
  y -= 20;

  // ── contents table ──
  const cols = [M, M + 96, M + 210, M + 300];
  const head = ['UNIT ID', 'PRODUCT', 'KIND', 'SIZE'];
  head.forEach((h, i) => page.drawText(h, { x: cols[i], y, size: 8, font: bold, color: rgb(0.45, 0.45, 0.45) }));
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: A5.w - M, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 15;

  for (const it of doc.items) {
    if (y < M + 40) {
      page = pdf.addPage([A5.w, A5.h]);
      y = A5.h - M;
    }
    page.drawText(it.uniqueId, { x: cols[0], y, size: 9, font: bold });
    const name = it.productName.length > 24 ? `${it.productName.slice(0, 23)}…` : it.productName;
    page.drawText(name, { x: cols[1], y, size: 9, font });
    page.drawText(familyLabel[it.family] ?? it.family, { x: cols[2], y, size: 9, font });
    // kg and litres are labelled per unit, never blended into a carton total.
    page.drawText(it.size ?? '—', { x: cols[3], y, size: 9, font });
    if (it.batchNumber) {
      y -= 10;
      page.drawText(`batch ${it.batchNumber}`, { x: cols[1], y, size: 7, font, color: rgb(0.55, 0.55, 0.55) });
    }
    y -= 16;
  }

  return Buffer.from(await pdf.save());
}
