import { BadRequestException } from '@nestjs/common';
import { FgFamily } from '@prisma/client';

/**
 * The three finished-goods families and how each is identified.
 *
 * Hardener and thinner are real produced packages with the same lifecycle as a paint drum
 * (QR, status machine, dispatch lock, returns, trace), so they live in the SAME
 * FinishedGood table told apart by `family`. Each family draws its running number from its
 * OWN sequence and wears its own human prefix, so a scan or a report can never confuse a
 * paint drum (FG-) with a hardener (FGHD-) or thinner (FGTH-).
 *
 * NOTE the prefix ordering matters: FGHD-/FGTH- must be tested BEFORE FG-, because every
 * id also begins with "FG". `familyOfId` walks the more specific prefixes first.
 */
export interface FamilyMeta {
  family: FgFamily;
  prefix: string;
  seq: string;
  /** Human label for slips, labels and screens. */
  label: string;
}

export const FAMILY_META: Record<FgFamily, FamilyMeta> = {
  FINISHED_GOOD: { family: 'FINISHED_GOOD', prefix: 'FG-', seq: 'finished_good_unique_seq', label: 'Finished paint' },
  HARDENER: { family: 'HARDENER', prefix: 'FGHD-', seq: 'finished_good_hardener_seq', label: 'Hardener' },
  THINNER: { family: 'THINNER', prefix: 'FGTH-', seq: 'finished_good_thinner_seq', label: 'Thinner' },
};

/** Most-specific prefix first, so "FGHD-000001" resolves to HARDENER, not FINISHED_GOOD. */
const BY_PREFIX_SPECIFICITY: FamilyMeta[] = [FAMILY_META.HARDENER, FAMILY_META.THINNER, FAMILY_META.FINISHED_GOOD];

/** All three sequences — used at startup (ensure) and flush (reset). */
export const FG_FAMILY_SEQUENCES = Object.values(FAMILY_META).map((m) => m.seq);

/** Zero-padded id in the family's own series, e.g. formatFamilyId('HARDENER', 7) → FGHD-000007. */
export function formatFamilyId(family: FgFamily, n: number | bigint): string {
  return `${FAMILY_META[family].prefix}${String(n).padStart(6, '0')}`;
}

/** Which family an id belongs to, or null if it is not a finished-goods id at all. */
export function familyOfId(uniqueId: string): FgFamily | null {
  const id = uniqueId.trim().toUpperCase();
  return BY_PREFIX_SPECIFICITY.find((m) => id.startsWith(m.prefix))?.family ?? null;
}

/**
 * True for ANY finished-goods family id (FG-/FGHD-/FGTH-). Raw-material units (MC-) and
 * anything else are false, so the dispatch scanner and returns still reject a wrong code —
 * they simply now accept all three produced families, not paint alone.
 */
export function isFinishedGoodId(uniqueId: string): boolean {
  return familyOfId(uniqueId) !== null;
}

/** The sequence to pull the next number from for a given id's family. Throws on a non-FG id. */
export function seqForId(uniqueId: string): string {
  const family = familyOfId(uniqueId);
  if (!family) throw new BadRequestException(`${uniqueId} is not a finished-goods code.`);
  return FAMILY_META[family].seq;
}
