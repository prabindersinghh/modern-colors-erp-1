import * as fs from 'fs';
import * as path from 'path';
import { PurchaseOrderService } from './purchase-order.service';

/**
 * Commercial isolation — what may leave the server in an invoice response.
 *
 * The invoice document is the only genuinely commercial artifact in this system: there is
 * no price, rate, amount or total column anywhere in the schema, and the AI extraction
 * contract never asks for one. So the things worth guarding are narrow and specific:
 *
 *  - `fileKey`     — the raw R2 storage key. An infrastructure identifier we deliberately
 *                    strip from error messages (44df396) and were handing out in a body.
 *  - `extractedJson` — the full extraction payload.
 *
 * Both were being returned by GET /purchase-orders and GET /purchase-orders/:id, because
 * Prisma returns every scalar when you use `include` without `select`. This spec is what
 * stops that regressing, and what forces a decision if a price column is ever added.
 */

const FORBIDDEN = ['fileKey', 'extractedJson'] as const;

describe('invoice reads expose no storage key and no extraction payload', () => {
  // TypeScript `private` is compile-time only, so the real object is reachable at runtime
  // — which makes this an assertion about the shipped behaviour, not about the source text.
  const safeFields = (PurchaseOrderService as unknown as { SAFE_FIELDS: Record<string, true> })
    .SAFE_FIELDS;

  it('the allow-list exists and is a real allow-list, not an exclusion', () => {
    expect(safeFields).toBeDefined();
    // Every entry must be an explicit `true`; a nested select here would be a way to
    // smuggle a relation's scalars back in.
    expect(Object.values(safeFields).every((v) => v === true)).toBe(true);
  });

  it.each(FORBIDDEN)('%s is NOT in the allow-list', (field) => {
    expect(Object.keys(safeFields)).not.toContain(field);
  });

  it('still returns everything a caller legitimately needs', () => {
    // If this fails, someone tightened the list too far and a screen has gone blank.
    for (const needed of ['id', 'poNumber', 'supplier', 'fileName', 'status', 'createdAt']) {
      expect(Object.keys(safeFields)).toContain(needed);
    }
  });
});

describe('the read paths use the allow-list, not a bare include', () => {
  const src = fs.readFileSync(path.join(__dirname, 'purchase-order.service.ts'), 'utf8');

  /** Body of a named async method, up to the next method at the same indentation. */
  const methodBody = (name: string) => {
    const start = src.indexOf(`  async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + 10);
    const next = rest.search(/\n  (async |\/\*\*|private )/);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it.each(['list', 'findOne'])('%s() selects through SAFE_FIELDS', (method) => {
    expect(methodBody(method)).toMatch(/SAFE_FIELDS/);
  });

  it('the storage key is read ONLY where the file is actually fetched', () => {
    // getFile/extract need the key to pull the object from R2; nothing else may touch it.
    // Anything outside those is a candidate for reaching a response body.
    const readers = ['getFile', 'extract'];
    for (const [i, line] of src.split('\n').entries()) {
      if (!/po\.fileKey|\.fileKey\b/.test(line)) continue;
      if (/fileKey: key/.test(line)) continue; // the upload write
      const before = src.split('\n').slice(0, i).join('\n');
      const enclosing = [...before.matchAll(/  async (\w+)\(/g)].at(-1)?.[1] ?? '(top level)';
      expect({ line: line.trim(), enclosing }).toEqual({
        line: line.trim(),
        enclosing: expect.stringMatching(new RegExp(`^(${readers.join('|')})$`)),
      });
    }
  });
});

describe('the schema still holds no commercial data', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'), 'utf8');

  it('no model declares a price, rate, amount, total or cost column', () => {
    // Not a style rule — a forcing function. The day someone adds a price column, this
    // fails and they have to decide who is allowed to see it, rather than it silently
    // riding out on an existing endpoint.
    const offenders = schema
      .split('\n')
      .map((l, i) => ({ line: l.trim(), n: i + 1 }))
      .filter(({ line }) => /^(price|unitPrice|rate|amount|lineTotal|grandTotal|total|cost|taxableValue)\s/i.test(line));
    expect(offenders).toEqual([]);
  });
});
