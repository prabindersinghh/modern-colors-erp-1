import { CatalogueValidationService } from './catalogue-validation.service';

/**
 * Catalogue import validation.
 *
 * The load-bearing requirement is that this layer is ASSISTIVE, NEVER A GATE: if the
 * AI pass cannot run — no API key, a timeout, a malformed response — the import must
 * still work on deterministic checks alone. Those cases are covered first.
 */
describe('CatalogueValidationService', () => {
  const row = (n: number, over: Partial<Record<string, string | null>> = {}) => ({
    row: n,
    materialName: 'Titanium Dioxide',
    sku: `SKU-${n}`,
    hsnCode: '32061110',
    category: 'Pigment',
    unit: 'KG',
    standardPackaging: '25 KG Bag',
    ...over,
  });

  /** No catalogue rows match, so "already exists" never fires in these tests. */
  const prisma = { masterCatalogueItem: { findMany: jest.fn().mockResolvedValue([]) } };
  const settings = { getDecryptedKey: jest.fn().mockResolvedValue(null) };
  const config = { get: jest.fn().mockReturnValue('claude-opus-4-8') };

  const make = () =>
    new CatalogueValidationService(
      settings as never,
      config as never,
      prisma as never,
    );

  beforeEach(() => {
    prisma.masterCatalogueItem.findMany.mockClear().mockResolvedValue([]);
    settings.getDecryptedKey.mockClear().mockResolvedValue(null);
  });

  describe('never blocks the import', () => {
    it('returns deterministic flags when no API key is configured', async () => {
      const res = await make().validate([row(2), row(3, { materialName: '' })]);
      expect(res.aiUsed).toBe(false);
      expect(res.aiSkippedReason).toBe('no_key');
      // The missing-name error must still be reported without AI.
      expect(res.flags.some((f) => f.field === 'materialName' && f.severity === 'error')).toBe(true);
    });

    it('skips AI entirely when asked (small edits should not wait on an API call)', async () => {
      const res = await make().validate([row(2)], { useAi: false });
      expect(res.aiUsed).toBe(false);
      expect(res.aiSkippedReason).toBe('skipped');
      expect(settings.getDecryptedKey).not.toHaveBeenCalled();
    });

    it('skips AI for very large files but still runs deterministic checks', async () => {
      const many = Array.from({ length: 250 }, (_, i) => row(i + 2));
      const res = await make().validate(many);
      expect(res.aiUsed).toBe(false);
      expect(res.aiSkippedReason).toMatch(/too_many_rows/);
    });

    it('degrades to deterministic flags if the AI call throws', async () => {
      settings.getDecryptedKey.mockRejectedValue(new Error('boom'));
      const res = await make().validate([row(2, { materialName: '' })]);
      expect(res.aiUsed).toBe(false);
      expect(res.flags.length).toBeGreaterThan(0); // still useful
    });
  });

  describe('deterministic checks', () => {
    it('errors on a missing material name', async () => {
      const res = await make().validate([row(2, { materialName: null })], { useAi: false });
      const f = res.flags.find((x) => x.field === 'materialName');
      expect(f?.severity).toBe('error');
    });

    it('errors on a duplicate SKU within the same file', async () => {
      const res = await make().validate(
        [row(2, { sku: 'DUP-1' }), row(3, { sku: 'dup-1' })], // case-insensitive
        { useAi: false },
      );
      const f = res.flags.find((x) => x.row === 3 && x.field === 'sku');
      expect(f?.severity).toBe('error');
      expect(f?.message).toMatch(/row 2/);
    });

    it('warns (does not error) when a SKU already exists — re-import is a valid update', async () => {
      prisma.masterCatalogueItem.findMany.mockResolvedValue([
        { sku: 'SKU-2', materialName: 'Existing Material' },
      ]);
      const res = await make().validate([row(2)], { useAi: false });
      const f = res.flags.find((x) => x.field === 'sku');
      expect(f?.severity).toBe('warning');
      expect(f?.message).toMatch(/UPDATE/);
    });

    it('warns on a malformed HSN code', async () => {
      const res = await make().validate([row(2, { hsnCode: 'ABC123' })], { useAi: false });
      expect(res.flags.some((f) => f.field === 'hsnCode' && f.severity === 'warning')).toBe(true);
    });

    it('warns when the SKU is only a number (likely a weight in the wrong column)', async () => {
      const res = await make().validate([row(2, { sku: '25' })], { useAi: false });
      const f = res.flags.find((x) => x.field === 'sku');
      expect(f?.message).toMatch(/only a number/);
    });

    it('never flags a blank OPTIONAL field', async () => {
      const res = await make().validate(
        [row(2, { sku: null, hsnCode: null, category: null, unit: null, standardPackaging: null })],
        { useAi: false },
      );
      // Blank is how you say "not known" — flagging it would train Store to type junk.
      expect(res.flags).toHaveLength(0);
    });

    it('returns no flags for a clean file', async () => {
      const res = await make().validate([row(2), row(3), row(4)], { useAi: false });
      expect(res.flags).toHaveLength(0);
    });
  });
});
