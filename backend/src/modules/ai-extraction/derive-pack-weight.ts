/**
 * Deterministic recovery of the per-package weight when AI extraction returns null.
 *
 * WHY THIS EXISTS
 * Each unit's opening stock balance now comes from the PO's per-package weight, so a
 * null weight means that sack cannot be issued to production until someone fixes it.
 * Real supplier invoices state the pack size in several places, and the model does not
 * always pick it up:
 *
 *   Rallison   "Pack Size 25 Kg 1 BAG"            → a dedicated column       (usually extracted)
 *   Vimal      "Packing: 4 Drums x 25 Kgs"        → free text under the line (often missed)
 *   Vimal      "TEGO DISPERS 673 (25KGS)"         → inside the description   (often missed)
 *   P.K. Dyes  "CARB-10 B ... 2,300.000 KG"       → genuinely absent         (operator must enter)
 *
 * These rules are intentionally conservative: they only fire on unambiguous patterns, and
 * they never overwrite a weight the extractor already produced. Anything they cannot
 * resolve stays null and is surfaced to the operator at Review & Confirm — a wrong weight
 * silently entering stock is far worse than a missing one that gets flagged.
 */

/** Units we accept, normalised to a kilogram multiplier. Litre-based packs keep their number. */
const UNIT_FACTOR: Record<string, number> = {
  kg: 1,
  kgs: 1,
  kilo: 1,
  kilos: 1,
  kilogram: 1,
  kilograms: 1,
  g: 0.001,
  gm: 0.001,
  gms: 0.001,
  gram: 0.001,
  grams: 0.001,
  mt: 1000,
  ton: 1000,
  tons: 1000,
  tonne: 1000,
  tonnes: 1000,
  // Volume: we store the numeric pack size as-is (a "20 L" pail is recorded as 20).
  l: 1,
  ltr: 1,
  ltrs: 1,
  litre: 1,
  litres: 1,
  liter: 1,
  liters: 1,
};

const UNIT_ALTERNATION = Object.keys(UNIT_FACTOR)
  .sort((a, b) => b.length - a.length) // longest first so "kgs" wins over "kg"
  .join('|');

/** A package word that can precede/follow a pack size, e.g. "4 Drums x 25 Kgs". */
const PACKAGE_WORD = 'bags?|drums?|cans?|cartons?|containers?|pails?|jars?|bottles?|sacks?|boxes|box';

function toKg(value: number, unit: string): number | null {
  const f = UNIT_FACTOR[unit.toLowerCase().replace(/\./g, '')];
  if (f == null) return null;
  const kg = value * f;
  // Sanity band: a single package between 0.01 kg and 2000 kg. Anything outside is
  // almost certainly a total, a price or a misparse — better null than wrong.
  if (!Number.isFinite(kg) || kg <= 0.009 || kg > 2000) return null;
  return Number(kg.toFixed(4));
}

/**
 * "Packing: 4 Drums x 25 Kgs" / "5 Bags x 10 Kgs" / "1 Drum x 200 Kgs"
 * The number AFTER the multiplier is the per-package size.
 */
function fromPackingNote(text: string): number | null {
  const re = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(?:${PACKAGE_WORD})\\s*(?:x|\\*|×|of)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALTERNATION})\\b`,
    'i',
  );
  const m = re.exec(text);
  return m ? toKg(parseFloat(m[2]), m[3]) : null;
}

/**
 * "Pack Size 25 Kg 1 BAG" / "25 Kg / Bag" / "25Kg per bag"
 * A size immediately tied to a single package word.
 */
function fromPackSize(text: string): number | null {
  const re = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALTERNATION})\\s*(?:\\/|per|-|–)?\\s*(?:1\\s*)?(?:${PACKAGE_WORD})\\b`,
    'i',
  );
  const m = re.exec(text);
  return m ? toKg(parseFloat(m[1]), m[2]) : null;
}

/**
 * Weight embedded in the description: "TEGO DISPERS 673 (25KGS)", "AEROSIL 200 (10KGS)",
 * "QUARTZ POWDER GQ-4010-IPPOLM-25KG".
 */
function fromDescription(text: string): number | null {
  const re = new RegExp(`(?:\\(|\\[|-|\\s)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALTERNATION})\\s*(?:\\)|\\]|$|\\s)`, 'i');
  const m = re.exec(text);
  return m ? toKg(parseFloat(m[1]), m[2]) : null;
}

/**
 * Total ÷ package count, only when both are unambiguous and divide sensibly.
 * "100.000 Kgs" over "4 Drums" → 25.
 */
function fromTotalOverCount(totalKg: number | null, quantity: number | null): number | null {
  if (totalKg == null || !quantity || quantity <= 0) return null;
  const per = totalKg / quantity;
  // Reject results that look like a misparse rather than a real pack size.
  if (!Number.isFinite(per) || per <= 0.009 || per > 2000) return null;
  return Number(per.toFixed(4));
}

export interface PackWeightSource {
  /** The line's description / "Description of Goods" text. */
  materialName?: string | null;
  /** Any free-text packing note captured alongside the line. */
  packingNote?: string | null;
  /** Number of physical packages on the line. */
  quantity?: number | null;
  /** Bulk total for the line in kg, when the document stated one. */
  totalKg?: number | null;
}

export interface DerivedPackWeight {
  weight: number;
  /** Which rule produced it — recorded in the audit trail so a wrong value is traceable. */
  source: 'packing-note' | 'pack-size' | 'description' | 'total-over-count';
}

/**
 * Try to derive the per-package weight. Returns null when nothing is confident enough,
 * in which case the operator supplies it once per line at Review & Confirm.
 *
 * Order matters: an explicit packing note beats a pack-size column, which beats a weight
 * buried in the description, which beats arithmetic on the total.
 */
export function derivePackWeight(src: PackWeightSource): DerivedPackWeight | null {
  const note = (src.packingNote ?? '').trim();
  const name = (src.materialName ?? '').trim();

  if (note) {
    const w = fromPackingNote(note) ?? fromPackSize(note);
    if (w != null) return { weight: w, source: 'packing-note' };
  }

  if (name) {
    const w = fromPackingNote(name);
    if (w != null) return { weight: w, source: 'packing-note' };
    const ps = fromPackSize(name);
    if (ps != null) return { weight: ps, source: 'pack-size' };
    const d = fromDescription(name);
    if (d != null) return { weight: d, source: 'description' };
  }

  const t = fromTotalOverCount(src.totalKg ?? null, src.quantity ?? null);
  if (t != null) return { weight: t, source: 'total-over-count' };

  return null;
}
