import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PDFDocument, StandardFonts, PDFFont, PDFPage, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import Jimp from 'jimp';

/** Raw-material unit label (MC-xxxxxx) — printed at receiving. */
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

/**
 * Finished-goods unit label (FG-xxxxxx) — printed after a production output is
 * confirmed. A DIFFERENT shape from QrPayload: there is no supplier, PO or HSN,
 * and the product is `productName`, not `materialName`.
 */
export interface FgQrPayload {
  kind: 'FINISHED_GOOD';
  uniqueId: string;
  productName: string;
  batch: string | null;
  department: string | null;
  size: string | null;
  shade: string | null;
  productSku: string | null;
  date: string; // ISO
}

export type AnyQrPayload = QrPayload | FgQrPayload;

export interface LabelInput {
  payload: AnyQrPayload;
}

function isFgPayload(p: AnyQrPayload): p is FgQrPayload {
  return (p as FgQrPayload).kind === 'FINISHED_GOOD';
}

/**
 * The fields a label actually renders, normalised from either payload shape.
 *
 * Both label kinds share one geometry and one renderer (so the 3×1.5in roll can
 * never drift between them); only the field mapping differs. Everything is
 * defensive about missing values because these payloads are JSON columns written
 * by earlier releases — a label must degrade to a blank line, never throw and
 * take the whole print run down.
 */
interface LabelView {
  id: string;
  title: string;
  lines: Array<[string, string | null | undefined]>;
  date: string | null;
}

/** ISO date → YYYY-MM-DD, or null if absent/unparseable. Never throws. */
function formatLabelDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toLabelView(p: AnyQrPayload): LabelView {
  if (isFgPayload(p)) {
    return {
      id: p.uniqueId ?? '',
      title: p.productName ?? '',
      lines: [
        ['Batch: ', p.batch],
        ['Size: ', p.size],
        ['Shade: ', p.shade],
        ['SKU: ', p.productSku],
      ],
      date: p.date ?? null,
    };
  }
  return {
    id: p.uniqueId ?? '',
    title: p.materialName ?? '',
    lines: [
      ['Inv: ', p.poNumber],
      ['HSN: ', p.hsnCode],
    ],
    date: p.date ?? null,
  };
}

// Physical sticker size: 3 in × 1.5 in = 216 pt × 108 pt (72 pt/in). See item 11.
const LABEL_W = 216;
const LABEL_H = 108;

/**
 * QR raster width for PRINT. The QR occupies ~1.3in on the label, so 256px is ~197 dpi —
 * far above the ~150 dpi a scanner needs, and a QR is pure black/white so it stays
 * razor-sharp. Down from 512, which cost 4x the encode time for no visible gain.
 */
const QR_PRINT_PX = 256;

/** How many QR images to encode concurrently (CPU-bound; keeps big batches responsive). */
const QR_CONCURRENCY = 8;

/** Map with bounded concurrency — parallelises the encode without unbounded memory. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Raster geometry for the individual label PNGs — 2:1 like the physical 3×1.5in sticker,
 * at ~200dpi. The QR sits on the left, the printed fields on the right.
 */
const PNG_LABEL_W = 600;
const PNG_LABEL_H = 300;
const PNG_LABEL_PAD = 20;

/**
 * jimp ships its own bitmap fonts, so label PNGs render identically everywhere —
 * critically, on the container image, which has no system fonts installed. Loaded once
 * and reused; a load failure is cached as "retry next time" so a transient problem
 * doesn't permanently disable the printed text.
 */
type JimpFont = Awaited<ReturnType<typeof Jimp.loadFont>>;
let labelFonts: Promise<{ big: JimpFont; small: JimpFont }> | null = null;
function loadLabelFonts() {
  if (!labelFonts) {
    labelFonts = Promise.all([
      Jimp.loadFont(Jimp.FONT_SANS_32_BLACK),
      Jimp.loadFont(Jimp.FONT_SANS_16_BLACK),
    ])
      .then(([big, small]) => ({ big, small }))
      .catch((e) => {
        labelFonts = null;
        throw e;
      });
  }
  return labelFonts;
}

/**
 * QR generation (1 per physical unit) + printable outputs:
 *  - a label sheet PDF sized to 3×1.5" stickers (item 11),
 *  - individual PNGs bundled as a ZIP, named by unique ID (item 12).
 */
@Injectable()
export class QrService {
  dataUrl(payload: AnyQrPayload): Promise<string> {
    return QRCode.toDataURL(JSON.stringify(payload), { width: 320, margin: 1 });
  }

  pngBuffer(payload: AnyQrPayload, width = QR_PRINT_PX): Promise<Buffer> {
    return QRCode.toBuffer(JSON.stringify(payload), { type: 'png', width, margin: 1 });
  }

  /**
   * A single unit's label rendered as a PNG: the QR on the left and the SAME key fields
   * the PDF roll prints on the right (unique ID, material/product name, HSN/invoice or
   * batch/size/shade, date). This is what the "Individual PNGs" export uses, so every
   * downloaded image is a readable label — not a bare QR square that can't be identified
   * without scanning it.
   */
  async labelPngBuffer(payload: AnyQrPayload): Promise<Buffer> {
    const { big, small } = await loadLabelFonts();
    const view = toLabelView(payload);

    const W = PNG_LABEL_W;
    const H = PNG_LABEL_H;
    const pad = PNG_LABEL_PAD;
    const qrSize = H - pad * 2;
    const img = new Jimp(W, H, 0xffffffff);

    // QR on the left, sized to the label height.
    const qr = await Jimp.read(await this.pngBuffer(payload, qrSize));
    qr.resize(qrSize, qrSize);
    img.composite(qr, pad, pad);

    // Key fields stacked on the right.
    const tx = pad + qrSize + pad;
    const maxW = W - pad - tx;
    let ty = pad - 2;
    const line = (font: JimpFont, text: string, maxHeight?: number) => {
      if (!text) return;
      if (maxHeight != null) img.print(font, tx, ty, text, maxW, maxHeight);
      else img.print(font, tx, ty, text, maxW);
      ty += Math.min(maxHeight ?? Infinity, Jimp.measureTextHeight(font, text, maxW)) + 3;
    };

    line(big, view.id); // unique ID — the largest field
    line(small, view.title, 48); // material / product name — up to ~2 lines
    for (const [label, value] of view.lines) if (value) line(small, `${label}${value}`);
    const date = formatLabelDate(view.date);
    if (date) line(small, date);

    return img.getBufferAsync(Jimp.MIME_PNG);
  }

  /**
   * ONE label per PDF page for a continuous label-roll printer: each page is exactly
   * 3×1.5" (216×108pt) with a single label filling it edge-to-edge (only the smallest
   * safe print margin). Page count === number of units, so the printer feeds one
   * physical sticker per page.
   */
  async buildLabelRoll(items: LabelInput[]): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    // Encode every QR PNG up front, in parallel. This is the expensive part and it is
    // pure CPU per item, so it parallelises cleanly — previously it ran one at a time
    // interleaved with PDF drawing. Output/format is unchanged.
    const pngs = await mapLimit(items, QR_CONCURRENCY, (item) => this.pngBuffer(item.payload));

    // Identical QR payloads (rare, but possible) embed once and are reused.
    const embedded = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();
    for (let i = 0; i < items.length; i++) {
      const png = pngs[i];
      const key = png.toString('base64');
      let img = embedded.get(key);
      if (!img) {
        img = await doc.embedPng(png);
        embedded.set(key, img);
      }
      const page = doc.addPage([LABEL_W, LABEL_H]);
      // yTop = LABEL_H, x = 0, no cut border → the label fills the whole page.
      await this.drawLabel(page, 0, LABEL_H, items[i].payload, img, font, bold, false);
    }
    // objectsPerTick keeps pdf-lib from starving the event loop on very large rolls.
    // useObjectStreams:false skips pdf-lib's object-stream compression, which dominated
    // save time on big rolls. The PDF is slightly larger but renders identically.
    const bytes = await doc.save({ objectsPerTick: 200, useObjectStreams: false });
    return Buffer.from(bytes);
  }

  /**
   * ZIP of individual label PNGs, one per unit, named "<uniqueId>.png" (item 12).
   *
   * Each PNG is a full label (QR + printed fields). If the image library or a font ever
   * fails at runtime, that unit falls back to the bare QR PNG — the previous behaviour —
   * so the export always succeeds and never 500s. The worst case is an image without the
   * printed text, never a broken download.
   */
  async buildLabelsZip(items: LabelInput[]): Promise<Buffer> {
    const zip = new JSZip();
    const pngs = await mapLimit(items, QR_CONCURRENCY, async ({ payload }) => {
      try {
        return await this.labelPngBuffer(payload);
      } catch {
        return this.pngBuffer(payload);
      }
    });
    items.forEach(({ payload }, i) => {
      const safe = payload.uniqueId.replace(/[^A-Za-z0-9._-]/g, '_') || 'unit';
      zip.file(`${safe}.png`, pngs[i]);
    });
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  // Draw one 3×1.5" label at (x, yTop): QR on the left, key fields on the right.
  private async drawLabel(
    page: PDFPage,
    x: number,
    yTop: number,
    payload: AnyQrPayload,
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

    // Normalise the payload (raw-material OR finished-goods) into one view, so
    // both label kinds share this renderer and can never drift in geometry.
    const view = toLabelView(payload);

    // Unique ID — the primary, largest field.
    page.drawText(this.fit(view.id, bold, 12, maxW), { x: tx, y: ty, size: 12, font: bold, color: ink });
    ty -= 15;

    // Product / material name — wrap to at most 2 lines.
    for (const ln of this.wrap(view.title, font, 9, maxW, 2)) {
      page.drawText(ln, { x: tx, y: ty, size: 9, font, color: ink });
      ty -= 11;
    }

    const small = (label: string, value: string | null | undefined) => {
      if (!value) return;
      page.drawText(this.fit(`${label}${value}`, font, 8, maxW), { x: tx, y: ty, size: 8, font, color: ink });
      ty -= 10;
    };
    for (const [label, value] of view.lines) small(label, value);
    // A malformed/missing date must not abort the print run.
    small('', formatLabelDate(view.date));

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
    if (!s) return '';
    if (font.widthOfTextAtSize(s, size) <= maxW) return s;
    let out = s;
    while (out.length > 1 && font.widthOfTextAtSize(out + '…', size) > maxW) out = out.slice(0, -1);
    return out + '…';
  }

  // Word-wrap to at most `maxLines` lines that each fit maxW; last line truncated.
  private wrap(s: string, font: PDFFont, size: number, maxW: number, maxLines: number): string[] {
    // Defensive: these strings come from JSON payload columns written by earlier
    // releases. A missing field must render blank, not throw and kill the roll.
    const words = (s ?? '').split(/\s+/).filter(Boolean);
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
