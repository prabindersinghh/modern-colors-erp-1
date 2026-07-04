import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PDFDocument, StandardFonts, PDFFont, PDFPage, rgb } from 'pdf-lib';
import JSZip from 'jszip';

export interface QrPayload {
  uniqueId: string;
  materialName: string;
  sku: string | null;
  hsnCode?: string | null;
  supplier: string | null;
  poNumber: string | null;
  batch: string | null;
  date: string; // ISO
}

export interface LabelInput {
  payload: QrPayload;
}

// Physical sticker size: 3 in × 1.5 in = 216 pt × 108 pt (72 pt/in). See item 11.
const LABEL_W = 216;
const LABEL_H = 108;

/**
 * QR generation (1 per physical unit) + printable outputs:
 *  - a label sheet PDF sized to 3×1.5" stickers (item 11),
 *  - individual PNGs bundled as a ZIP, named by unique ID (item 12).
 */
@Injectable()
export class QrService {
  dataUrl(payload: QrPayload): Promise<string> {
    return QRCode.toDataURL(JSON.stringify(payload), { width: 320, margin: 1 });
  }

  pngBuffer(payload: QrPayload): Promise<Buffer> {
    return QRCode.toBuffer(JSON.stringify(payload), { type: 'png', width: 512, margin: 1 });
  }

  /**
   * A4 sheet packed with 3×1.5" labels (2 columns × 7 rows = 14 per page) at
   * near-zero margins, ready to print on label stock or plain paper.
   */
  async buildLabelSheet(items: LabelInput[]): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = 595.28; // A4 portrait
    const PAGE_H = 841.89;
    const margin = 14;
    const gutter = 8;
    const cols = Math.max(1, Math.floor((PAGE_W - 2 * margin + gutter) / (LABEL_W + gutter)));
    const rows = Math.max(1, Math.floor((PAGE_H - 2 * margin + gutter) / (LABEL_H + gutter)));
    const perPage = cols * rows;

    for (let i = 0; i < items.length; i++) {
      if (i % perPage === 0) doc.addPage([PAGE_W, PAGE_H]);
      const page = doc.getPages()[doc.getPageCount() - 1];
      const idx = i % perPage;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = margin + col * (LABEL_W + gutter);
      const yTop = PAGE_H - margin - row * (LABEL_H + gutter);
      const qrPng = await this.pngBuffer(items[i].payload);
      const img = await doc.embedPng(qrPng);
      await this.drawLabel(page, x, yTop, items[i].payload, img, font, bold);
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  /** A single 3×1.5" label as its own one-page PDF (one QR per page — item 12). */
  async buildSingleLabel(item: LabelInput): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([LABEL_W, LABEL_H]);
    const img = await doc.embedPng(await this.pngBuffer(item.payload));
    await this.drawLabel(page, 0, LABEL_H, item.payload, img, font, bold, false);
    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  /** ZIP of individual QR PNGs, one per unit, named "<uniqueId>.png" (item 12). */
  async buildLabelsZip(items: LabelInput[]): Promise<Buffer> {
    const zip = new JSZip();
    for (const { payload } of items) {
      const safe = payload.uniqueId.replace(/[^A-Za-z0-9._-]/g, '_') || 'unit';
      zip.file(`${safe}.png`, await this.pngBuffer(payload));
    }
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  // Draw one 3×1.5" label at (x, yTop): QR on the left, key fields on the right.
  private async drawLabel(
    page: PDFPage,
    x: number,
    yTop: number,
    payload: QrPayload,
    img: Awaited<ReturnType<PDFDocument['embedPng']>>,
    font: PDFFont,
    bold: PDFFont,
    border = true,
  ) {
    const ink = rgb(0.09, 0.1, 0.12);
    const pad = 7;
    const qrSize = LABEL_H - pad * 2; // ~94 pt square
    page.drawImage(img, { x: x + pad, y: yTop - pad - qrSize, width: qrSize, height: qrSize });

    const tx = x + pad + qrSize + 8;
    const maxW = x + LABEL_W - pad - tx;
    let ty = yTop - pad - 9;

    // Unique ID — the primary, largest field.
    page.drawText(this.fit(payload.uniqueId, bold, 12, maxW), { x: tx, y: ty, size: 12, font: bold, color: ink });
    ty -= 15;

    // Material name — wrap to at most 2 lines.
    for (const ln of this.wrap(payload.materialName, font, 9, maxW, 2)) {
      page.drawText(ln, { x: tx, y: ty, size: 9, font, color: ink });
      ty -= 11;
    }

    const small = (label: string, value: string | null) => {
      if (!value) return;
      page.drawText(this.fit(`${label}${value}`, font, 8, maxW), { x: tx, y: ty, size: 8, font, color: ink });
      ty -= 10;
    };
    small('PO: ', payload.poNumber);
    if (payload.hsnCode) small('HSN: ', payload.hsnCode);
    small('', new Date(payload.date).toISOString().slice(0, 10));

    if (border) {
      page.drawRectangle({
        x,
        y: yTop - LABEL_H,
        width: LABEL_W,
        height: LABEL_H,
        borderColor: rgb(0.8, 0.8, 0.82),
        borderWidth: 0.5,
      });
    }
  }

  // Truncate a single line to fit maxW at the given size (adds an ellipsis).
  private fit(s: string, font: PDFFont, size: number, maxW: number): string {
    if (font.widthOfTextAtSize(s, size) <= maxW) return s;
    let out = s;
    while (out.length > 1 && font.widthOfTextAtSize(out + '…', size) > maxW) out = out.slice(0, -1);
    return out + '…';
  }

  // Word-wrap to at most `maxLines` lines that each fit maxW; last line truncated.
  private wrap(s: string, font: PDFFont, size: number, maxW: number, maxLines: number): string[] {
    const words = s.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxW) {
        cur = trial;
      } else {
        if (cur) lines.push(cur);
        cur = w;
        if (lines.length === maxLines - 1) break;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length === maxLines) lines[maxLines - 1] = this.fit(lines[maxLines - 1], font, size, maxW);
    return lines.length ? lines : [''];
  }
}
