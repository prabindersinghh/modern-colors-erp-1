import * as XLSX from 'xlsx';

/**
 * The downloadable catalogue-import template.
 *
 * Store previously had to guess the column layout, and a guessed header means a failed
 * or half-imported file. This hands them a known-good structure with worked examples,
 * so the common case becomes "fill in the blanks" instead of "reverse-engineer the
 * parser".
 *
 * Headers here are the CANONICAL names from HEADER_MAP in catalogue.service.ts. The
 * importer is deliberately tolerant of variants (case, spacing, "Item Code" for SKU),
 * but the template must emit the exact canonical spellings so a file produced from it
 * always parses.
 */
export const TEMPLATE_HEADERS = [
  'Material Name',
  'SKU',
  'HSN Code',
  'Category',
  'Unit',
  'Standard Packaging',
] as const;

/**
 * Example rows. Chosen to demonstrate the three things people get wrong:
 *  1. a fully-populated row (what good looks like),
 *  2. optional fields left BLANK rather than filled with "-", "N/A" or "0",
 *  3. a litre-based material, so unit/packaging are obviously not always KG.
 */
export const TEMPLATE_EXAMPLES: string[][] = [
  ['Titanium Dioxide', 'TIO2-001', '32061110', 'Pigment', 'KG', '25 KG Bag'],
  ['Acrylic Emulsion', 'ACEM-300', '39069010', 'Binder', 'LTR', '200 LTR Drum'],
  // Optional fields intentionally blank — this is the row that teaches "leave it empty".
  ['China Clay (Kaolin)', 'KAOL-210', '', 'Filler', 'KG', '50 KG Bag'],
];

/** Guidance rows appended under the examples. Prefixed with # so the parser skips them. */
const NOTES: string[][] = [
  [],
  ['# HOW TO USE THIS TEMPLATE'],
  ['# 1. Delete the three example rows above and add your own materials.'],
  ['# 2. Material Name is REQUIRED. Every other column may be left blank.'],
  ['# 3. Leave optional cells EMPTY — do not type "-", "N/A" or "0".'],
  ['# 4. SKU should be your supplier/item code. If a material has none, leave it blank'],
  ['#    and the system will assign a provisional TMP- code you can replace later.'],
  ['# 5. HSN Code is the tax code from the invoice (4-8 digits), not the item code.'],
  ['# 6. Re-importing a file UPDATES materials with a matching SKU — it does not'],
  ['#    create duplicates. This makes it safe to fix and re-upload.'],
  ['# 7. Lines starting with # are ignored, so you can leave these notes in place.'],
];

/** RFC 4180-ish quoting: wrap when the value contains a comma, quote or newline. */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV template. Emitted with a UTF-8 BOM and CRLF line endings so Excel on Windows
 * opens it with correct encoding and row breaks — without the BOM, Excel mangles any
 * non-ASCII material name.
 */
export function buildTemplateCsv(): Buffer {
  const rows = [[...TEMPLATE_HEADERS], ...TEMPLATE_EXAMPLES, ...NOTES];
  const body = rows.map((r) => r.map((c) => csvCell(c ?? '')).join(',')).join('\r\n');
  return Buffer.from('﻿' + body, 'utf8');
}

/**
 * Excel template. Same content, plus sensible column widths so the headers are readable
 * without the user having to resize anything.
 */
export function buildTemplateXlsx(): Buffer {
  const rows = [[...TEMPLATE_HEADERS], ...TEMPLATE_EXAMPLES, ...NOTES];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 8 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Catalogue');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
