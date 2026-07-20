import * as XLSX from 'xlsx';
import {
  buildTemplateCsv,
  buildTemplateXlsx,
  TEMPLATE_HEADERS,
  TEMPLATE_EXAMPLES,
} from './catalogue-template';

/**
 * The template must ROUND-TRIP: a file downloaded from here and re-uploaded unchanged
 * has to import cleanly. If the headers drift from the parser's canonical names, Store
 * gets a file that silently imports nothing — the exact failure the template exists to
 * prevent.
 */
describe('catalogue import template', () => {
  // Canonical header names as understood by HEADER_MAP in catalogue.service.ts.
  const CANONICAL = new Set([
    'material name',
    'sku',
    'hsn code',
    'category',
    'unit',
    'standard packaging',
  ]);

  it('emits headers the importer actually recognises', () => {
    for (const h of TEMPLATE_HEADERS) {
      expect(CANONICAL.has(h.toLowerCase())).toBe(true);
    }
  });

  it('CSV starts with a UTF-8 BOM so Excel opens it correctly', () => {
    const csv = buildTemplateCsv();
    expect(csv.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('CSV parses back to exactly the example rows, notes excluded', () => {
    const wb = XLSX.read(buildTemplateCsv(), { type: 'buffer', raw: false });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
      wb.Sheets[wb.SheetNames[0]],
      { defval: '' },
    );
    // Guidance rows are '#'-prefixed and are dropped by the parser's comment filter.
    const data = rows.filter(
      (r) => r['Material Name'] && !String(r['Material Name']).trimStart().startsWith('#'),
    );
    expect(data).toHaveLength(TEMPLATE_EXAMPLES.length);
    expect(data[0]['Material Name']).toBe('Titanium Dioxide');
    expect(data[0]['SKU']).toBe('TIO2-001');
  });

  it('XLSX parses back to the same example rows', () => {
    const wb = XLSX.read(buildTemplateXlsx(), { type: 'buffer', raw: false });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
      wb.Sheets[wb.SheetNames[0]],
      { defval: '' },
    );
    const data = rows.filter(
      (r) => r['Material Name'] && !String(r['Material Name']).trimStart().startsWith('#'),
    );
    expect(data).toHaveLength(TEMPLATE_EXAMPLES.length);
    expect(data.map((r) => r['Material Name'])).toEqual(TEMPLATE_EXAMPLES.map((e) => e[0]));
  });

  it('demonstrates a BLANK optional field rather than a placeholder', () => {
    // The third example leaves HSN empty on purpose: operators otherwise type "-" or
    // "N/A", which then imports as a literal value.
    const blankExample = TEMPLATE_EXAMPLES.find((r) => r[2] === '');
    expect(blankExample).toBeDefined();
    for (const row of TEMPLATE_EXAMPLES) {
      for (const cell of row) {
        expect(['-', 'N/A', 'n/a', 'NA', 'null']).not.toContain(cell);
      }
    }
  });

  it('includes usage guidance, all of it comment-prefixed so it never imports', () => {
    // Assert on PARSED CELLS, not raw lines: a note containing commas is CSV-quoted,
    // so its raw line begins with a quote while the CELL value still begins with '#'.
    // The parser's comment filter reads the cell, which is what actually matters.
    const wb = XLSX.read(buildTemplateCsv(), { type: 'buffer', raw: false });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
      wb.Sheets[wb.SheetNames[0]],
      { defval: '' },
    );
    const notes = rows
      .map((r) => String(r['Material Name'] ?? ''))
      .filter((v) => /HOW TO USE|REQUIRED|EMPTY|provisional/i.test(v));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n.trimStart().startsWith('#')).toBe(true);
  });
});
