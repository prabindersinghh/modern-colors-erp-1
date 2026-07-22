import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { SlipLine } from './receiving-slip.service';

/**
 * The receiving slip as a printable document — THE one renderer.
 *
 * Store and Gate both print from here, so the paper the gate guard carries across the
 * yard and the copy Store holds are the same document by construction rather than by
 * two implementations agreeing. Before this, "Print slip" was window.print() on the
 * dashboard page, which printed the surrounding screen furniture and could not be
 * scoped or downloaded.
 *
 * A4 portrait — deliberately NOT the 3x1.5in label geometry, which is a different
 * artifact rendered by buildLabelRoll and must not be disturbed.
 *
 * Carries no price, amount, HSN or invoice image: the slip is the commercial-free
 * record, and printing it must not become a way to move commercial data.
 */
export interface SlipDoc {
  slipNumber: string;
  supplier: string | null;
  receivedDate: Date;
  status: string;
  unitCount: number | null;
  scannedCount: number | null;
  lines: SlipLine[];
  generatedBy?: { name: string | null; email: string } | null;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 48; // margin

export async function buildSlipPdf(slip: SlipDoc): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  const text = (s: string, x: number, size = 10, f = font, colour = rgb(0.1, 0.1, 0.1)) =>
    page.drawText(s, { x, y, size, font: f, color: colour });

  // ── header ──
  text('RECEIVING SLIP', M, 18, bold);
  text(slip.slipNumber, A4.w - M - bold.widthOfTextAtSize(slip.slipNumber, 18), 18, bold);
  y -= 26;
  page.drawLine({
    start: { x: M, y },
    end: { x: A4.w - M, y },
    thickness: 1.5,
    color: rgb(0.92, 0.0, 0.008), // brand red
  });
  y -= 22;

  const meta: [string, string][] = [
    ['Supplier', slip.supplier ?? '—'],
    ['Received', slip.receivedDate.toISOString().slice(0, 10)],
    ['Status', slip.status],
    ['Units', slip.unitCount != null ? String(slip.unitCount) : 'not yet confirmed'],
  ];
  for (const [k, v] of meta) {
    text(k, M, 9, font, rgb(0.45, 0.45, 0.45));
    text(v, M + 90, 10, bold);
    y -= 16;
  }
  if (slip.scannedCount != null) {
    text('Scanned in', M, 9, font, rgb(0.45, 0.45, 0.45));
    text(String(slip.scannedCount), M + 90, 10, bold);
    y -= 16;
  }
  y -= 10;

  // ── line table ──
  const cols = [M, M + 210, M + 268, M + 336, M + 410];
  const head = ['MATERIAL', 'QTY', 'PACK', 'UNIT IDS', ''];
  for (const [i, h] of head.entries()) {
    if (!h) continue;
    page.drawText(h, { x: cols[i], y, size: 8, font: bold, color: rgb(0.45, 0.45, 0.45) });
  }
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 16;

  for (const l of slip.lines) {
    if (y < M + 60) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - M;
    }
    const name = l.materialName.length > 34 ? `${l.materialName.slice(0, 33)}…` : l.materialName;
    page.drawText(name, { x: cols[0], y, size: 10, font: bold });
    page.drawText(`${l.quantity} ${l.unit ?? ''}`.trim(), { x: cols[1], y, size: 10, font });
    // kg and litres are labelled per line and never added together.
    page.drawText(l.packWeight != null ? `${l.packWeight} ${l.measure}` : '—', { x: cols[2], y, size: 10, font });
    const ids = l.idFrom ? (l.idFrom === l.idTo ? l.idFrom : `${l.idFrom} - ${l.idTo}`) : '—';
    page.drawText(ids, { x: cols[3], y, size: 9, font });
    if (l.sku) {
      y -= 11;
      page.drawText(l.sku, { x: cols[0], y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    }
    y -= 18;
  }

  // ── footer: the hand-over record ──
  y = Math.max(y - 14, M + 44);
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 14;
  page.drawText(
    'This slip records what physically arrived. Prices remain on the supplier invoice.',
    { x: M, y, size: 8, font, color: rgb(0.45, 0.45, 0.45) },
  );
  y -= 22;
  page.drawText('Gate signature', { x: M, y: y - 10, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
  page.drawLine({ start: { x: M, y }, end: { x: M + 180, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  page.drawText('Store signature', { x: A4.w - M - 180, y: y - 10, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
  page.drawLine({
    start: { x: A4.w - M - 180, y },
    end: { x: A4.w - M, y },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });

  return Buffer.from(await doc.save());
}
