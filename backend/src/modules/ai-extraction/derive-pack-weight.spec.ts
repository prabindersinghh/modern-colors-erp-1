import { derivePackWeight } from './derive-pack-weight';

/**
 * Cases taken from the three real supplier invoices the client supplied, because
 * those are exactly the shapes that were producing null weights in production.
 *
 * A null weight now means a sack cannot be issued to production until an operator
 * fixes it, so these rules must be RIGHT rather than merely generous — a wrong
 * weight silently seeding stock is worse than a missing one that gets flagged.
 */
describe('derivePackWeight', () => {
  describe('Vimal Intertrade — "Packing: N Drums x M Kgs" (was extracting null)', () => {
    it('reads the per-package size from a packing note', () => {
      expect(derivePackWeight({ packingNote: 'Packing: 4 Drums x 25 Kgs' })).toEqual({
        weight: 25,
        source: 'packing-note',
      });
      expect(derivePackWeight({ packingNote: 'Packing: 5 Bags x 10 Kgs' })).toEqual({
        weight: 10,
        source: 'packing-note',
      });
      expect(derivePackWeight({ packingNote: 'Packing: 1 Drum x 200 Kgs' })).toEqual({
        weight: 200,
        source: 'packing-note',
      });
    });

    it('takes the per-package figure, never the package count', () => {
      // "4 Drums x 25 Kgs" must yield 25, not 4.
      expect(derivePackWeight({ packingNote: '4 Drums x 25 Kgs' })?.weight).toBe(25);
    });

    it('recovers the weight from the description when there is no note', () => {
      expect(derivePackWeight({ materialName: 'TEGO DISPERS 673 (25KGS)' })).toEqual({
        weight: 25,
        source: 'description',
      });
      expect(derivePackWeight({ materialName: 'AEROSIL 200 (10KGS)' })).toEqual({
        weight: 10,
        source: 'description',
      });
      expect(derivePackWeight({ materialName: 'ANCAMINE K 54 (200KGS)' })).toEqual({
        weight: 200,
        source: 'description',
      });
      expect(derivePackWeight({ materialName: 'QUARTZ POWDER GQ-4010-IPPOLM-25KG' })).toEqual({
        weight: 25,
        source: 'description',
      });
    });
  });

  describe('Rallison Paints — "Pack Size 25 Kg 1 BAG"', () => {
    it('reads a pack-size column', () => {
      expect(derivePackWeight({ packingNote: 'Pack Size 25 Kg 1 BAG' })?.weight).toBe(25);
      expect(derivePackWeight({ packingNote: '25 Kg / Bag' })?.weight).toBe(25);
      expect(derivePackWeight({ packingNote: '25Kg per bag' })?.weight).toBe(25);
    });
  });

  describe('P.K. Dyes — genuinely bulk, no pack size anywhere', () => {
    it('returns null rather than inventing a weight', () => {
      expect(derivePackWeight({ materialName: 'CARB-10 B', quantity: 1 })).toBeNull();
      expect(derivePackWeight({ materialName: 'CHINA CLAY POWDER', quantity: 1 })).toBeNull();
    });

    it('does not treat a bulk total as a package size', () => {
      // 2300 kg on a single bulk line is the TOTAL. 2300 > the 2000 kg sanity cap,
      // so total-over-count must reject it rather than seed a 2300 kg "package".
      expect(derivePackWeight({ materialName: 'CARB-10 B', quantity: 1, totalKg: 2300 })).toBeNull();
    });
  });

  describe('total ÷ count', () => {
    it('divides when both figures are unambiguous', () => {
      expect(derivePackWeight({ materialName: 'TEGO DISPERS', quantity: 4, totalKg: 100 })).toEqual({
        weight: 25,
        source: 'total-over-count',
      });
    });

    it('refuses when the count is missing or zero', () => {
      expect(derivePackWeight({ materialName: 'X', quantity: 0, totalKg: 100 })).toBeNull();
      expect(derivePackWeight({ materialName: 'X', totalKg: 100 })).toBeNull();
    });
  });

  describe('unit conversion', () => {
    it('converts grams to kilograms', () => {
      expect(derivePackWeight({ packingNote: '10 Bags x 500 GM' })?.weight).toBe(0.5);
    });

    it('keeps litre pack sizes as their stated number', () => {
      expect(derivePackWeight({ packingNote: '4 Cans x 20 LTR' })?.weight).toBe(20);
    });

    it('converts tonnes', () => {
      expect(derivePackWeight({ packingNote: '2 Containers x 1 MT' })?.weight).toBe(1000);
    });
  });

  describe('safety', () => {
    it('returns null for empty input', () => {
      expect(derivePackWeight({})).toBeNull();
      expect(derivePackWeight({ materialName: '', packingNote: '' })).toBeNull();
    });

    it('rejects implausible package sizes', () => {
      // A 5000 kg "package" is a total, not a sack.
      expect(derivePackWeight({ packingNote: '1 Drum x 5000 Kgs' })).toBeNull();
      expect(derivePackWeight({ materialName: 'THING (0 KG)' })).toBeNull();
    });

    it('ignores numbers with no recognised unit', () => {
      expect(derivePackWeight({ materialName: 'GRADE-7000NY S NO-0323' })).toBeNull();
      expect(derivePackWeight({ materialName: 'POLYESTER RESIN 2002 NO' })).toBeNull();
    });
  });
});
