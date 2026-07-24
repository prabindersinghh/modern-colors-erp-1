import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { SlipLine } from './receiving-slip.service';
import { LOGO_PNG_DATA_URL, LOGO_ASPECT } from './logo-asset';

/**
 * The receiving slip as a printable "GOOD RECEIPT NOTE" — THE one renderer.
 *
 * Store and Gate both print from here, so the paper the gate guard carries across the yard
 * and the copy Store holds are the same document by construction. The layout matches the
 * factory's own Good Receipt Note: the Modern Colours logo, a red rule, the GOOD RECEIPT
 * NOTE title, Supplier + Date of Receipt, a bordered table (Sr No / Material+code /
 * Quantity Received / Pack Size / Unit Codes), and Gate + Store signature lines.
 *
 * A4 portrait — deliberately NOT the 3x1.5in label geometry (buildLabelRoll) nor the A5
 * carton label (buildCartonLabelSheet); both are untouched by this renderer.
 *
 * Carries no price, amount, HSN or invoice image: the slip is the commercial-free record.
 * The UNIT (CODES) column shows the minted MC- ranges; on a slip whose units have not yet
 * been minted it reads "pending" — those codes arrive when the inward is confirmed.
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
const M = 40; // page margin
const BRAND_RED = rgb(0.92, 0.0, 0.008);
const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.42, 0.42, 0.42);
const HEADER_FILL = rgb(0.95, 0.95, 0.96);
const BORDER = rgb(0.72, 0.72, 0.74);

// Table columns — widths sum to the content width (A4 - 2*margin ≈ 515).
const COLS = [
  { key: 'sr', label: 'SR. NO.', w: 52, align: 'center' as const },
  { key: 'material', label: 'MATERIAL', w: 168, align: 'left' as const },
  { key: 'qty', label: 'QUANTITY\nRECEIVED', w: 108, align: 'center' as const },
  { key: 'pack', label: 'PACK SIZE', w: 88, align: 'center' as const },
  { key: 'codes', label: 'UNIT (CODES)', w: 99, align: 'center' as const },
];

export async function buildSlipPdf(slip: SlipDoc): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_DATA_URL.split(',')[1], 'base64'));

  const contentW = A4.w - M * 2;
  const drawHeader = (page: PDFPage): number => {
    let y = A4.h - M;

    // ── logo, centred ──
    const logoW = 150;
    const logoH = logoW / LOGO_ASPECT;
    page.drawImage(logo, { x: (A4.w - logoW) / 2, y: y - logoH, width: logoW, height: logoH });
    y -= logoH + 12;

    // ── red rule ──
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 1.6, color: BRAND_RED });
    y -= 30;

    // ── title, centred + underlined ──
    const title = 'GOOD RECEIPT NOTE';
    const tSize = 22;
    const tW = bold.widthOfTextAtSize(title, tSize);
    const tX = (A4.w - tW) / 2;
    page.drawText(title, { x: tX, y, size: tSize, font: bold, color: INK });
    page.drawLine({ start: { x: tX, y: y - 4 }, end: { x: tX + tW, y: y - 4 }, thickness: 1.4, color: INK });
    // slip number, small + unobtrusive (traceability), top-right
    page.drawText(slip.slipNumber, {
      x: A4.w - M - font.widthOfTextAtSize(slip.slipNumber, 9),
      y: A4.h - M - 8,
      size: 9,
      font,
      color: GREY,
    });
    y -= 34;

    // ── meta: Supplier / Date of Receipt ──
    const metaRow = (label: string, value: string) => {
      page.drawText(label, { x: M, y, size: 11, font: bold, color: INK });
      page.drawText(':', { x: M + 118, y, size: 11, font: bold, color: INK });
      page.drawText(value, { x: M + 132, y, size: 11, font, color: INK });
      y -= 26;
    };
    metaRow('Supplier', slip.supplier ?? '—');
    metaRow('Date of Receipt', slip.receivedDate.toISOString().slice(0, 10));
    y -= 8;
    return y;
  };

  let page = doc.addPage([A4.w, A4.h]);
  // Thin page border, like the printed GRN.
  page.drawRectangle({ x: M / 2, y: M / 2, width: A4.w - M, height: A4.h - M, borderColor: INK, borderWidth: 1 });
  let y = drawHeader(page);

  // ── table ──
  const ROW_H = 40;
  const HEAD_H = 34;
  const cellX = (i: number) => M + COLS.slice(0, i).reduce((s, c) => s + c.w, 0);

  const drawTableHead = (yTop: number): number => {
    page.drawRectangle({ x: M, y: yTop - HEAD_H, width: contentW, height: HEAD_H, color: HEADER_FILL, borderColor: BORDER, borderWidth: 0.75 });
    COLS.forEach((c, i) => {
      const x = cellX(i);
      if (i > 0) page.drawLine({ start: { x, y: yTop }, end: { x, y: yTop - HEAD_H }, thickness: 0.75, color: BORDER });
      // header labels may be two lines (QUANTITY / RECEIVED)
      const parts = c.label.split('\n');
      const lh = 11;
      let ty = yTop - HEAD_H / 2 + (parts.length * lh) / 2 - lh + 3;
      for (const p of parts) {
        const w = bold.widthOfTextAtSize(p, 9);
        page.drawText(p, { x: x + (c.w - w) / 2, y: ty, size: 9, font: bold, color: rgb(0.3, 0.3, 0.32) });
        ty -= lh;
      }
    });
    return yTop - HEAD_H;
  };

  const placeText = (text: string, x: number, w: number, ty: number, f: PDFFont, size: number, align: 'left' | 'center', colour = INK) => {
    const tw = f.widthOfTextAtSize(text, size);
    const tx = align === 'center' ? x + (w - tw) / 2 : x + 8;
    page.drawText(text, { x: tx, y: ty, size, font: f, color: colour });
  };

  y = drawTableHead(y);

  slip.lines.forEach((l, idx) => {
    if (y - ROW_H < M + 90) {
      // new page: border + header + table head
      page = doc.addPage([A4.w, A4.h]);
      page.drawRectangle({ x: M / 2, y: M / 2, width: A4.w - M, height: A4.h - M, borderColor: INK, borderWidth: 1 });
      y = drawHeader(page);
      y = drawTableHead(y);
    }
    const rowTop = y;
    const rowBottom = y - ROW_H;
    // row box + column separators
    page.drawRectangle({ x: M, y: rowBottom, width: contentW, height: ROW_H, borderColor: BORDER, borderWidth: 0.75 });
    COLS.forEach((c, i) => {
      if (i > 0) page.drawLine({ start: { x: cellX(i), y: rowTop }, end: { x: cellX(i), y: rowBottom }, thickness: 0.75, color: BORDER });
    });

    const mid = rowTop - ROW_H / 2;
    // SR NO
    placeText(String(idx + 1), cellX(0), COLS[0].w, mid - 4, font, 11, 'center');
    // MATERIAL — name (bold) over code (grey)
    const name = l.materialName.length > 26 ? `${l.materialName.slice(0, 25)}…` : l.materialName;
    page.drawText(name, { x: cellX(1) + 8, y: rowTop - 16, size: 11, font: bold, color: INK });
    if (l.sku) page.drawText(l.sku, { x: cellX(1) + 8, y: rowTop - 29, size: 9, font, color: GREY });
    // QUANTITY RECEIVED — "4 Bag"
    placeText(`${l.quantity}${l.unit ? ` ${l.unit}` : ''}`.trim(), cellX(2), COLS[2].w, mid - 4, font, 11, 'center');
    // PACK SIZE — "25 kg" (kg/L never blended: shown per line in its own measure)
    placeText(l.packWeight != null ? `${l.packWeight} ${l.measure ?? ''}`.trim() : '—', cellX(3), COLS[3].w, mid - 4, font, 11, 'center');
    // UNIT (CODES) — "MC-001 - MC-078", or "pending" before minting
    const codes = l.idFrom ? (l.idFrom === l.idTo ? l.idFrom : `${l.idFrom} - ${l.idTo}`) : 'pending';
    placeText(codes, cellX(4), COLS[4].w, mid - 4, l.idFrom ? bold : font, 9, 'center', l.idFrom ? INK : GREY);

    y = rowBottom;
  });

  // ── signatures ──
  const sigY = Math.max(y - 70, M + 70);
  const sigLine = (label: string, x: number) => {
    page.drawLine({ start: { x, y: sigY }, end: { x: x + 190, y: sigY }, thickness: 0.75, color: rgb(0.35, 0.35, 0.35) });
    const w = bold.widthOfTextAtSize(label, 10);
    page.drawText(label, { x: x + (190 - w) / 2, y: sigY - 16, size: 10, font: bold, color: INK });
  };
  sigLine('Gate Signature', M + 8);
  sigLine('Store Signature', A4.w - M - 198);

  // tiny commercial-free reminder, unobtrusive, at the very bottom
  page.drawText('This note records what physically arrived. Prices remain on the supplier invoice.', {
    x: M + 8,
    y: M + 6,
    size: 7.5,
    font,
    color: rgb(0.55, 0.55, 0.55),
  });

  return Buffer.from(await doc.save());
}
