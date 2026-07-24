import { FAMILY_META, FG_FAMILY_SEQUENCES, familyOfId, formatFamilyId, isFinishedGoodId, seqForId } from './fg-family';
import { isCartonId, formatCartonId } from '../packing/carton-id';

/**
 * The three finished-goods families and the carton id.
 *
 * The load-bearing subtlety: every id begins with "FG", so FGHD-/FGTH- must resolve to
 * hardener/thinner, NOT paint. A regression here would file a hardener as a paint drum.
 */
describe('finished-goods family identity', () => {
  it('formats each family in its own series with its own prefix', () => {
    expect(formatFamilyId('FINISHED_GOOD', 1)).toBe('FG-000001');
    expect(formatFamilyId('HARDENER', 12)).toBe('FGHD-000012');
    expect(formatFamilyId('THINNER', 7)).toBe('FGTH-000007');
  });

  it('resolves the family from an id, most-specific prefix first', () => {
    expect(familyOfId('FG-000001')).toBe('FINISHED_GOOD');
    expect(familyOfId('FGHD-000001')).toBe('HARDENER'); // NOT finished_good
    expect(familyOfId('FGTH-000001')).toBe('THINNER');
    expect(familyOfId('fghd-000009')).toBe('HARDENER'); // case-insensitive
    expect(familyOfId('MC-000001')).toBeNull();
    expect(familyOfId('PG-000001')).toBeNull();
  });

  it('isFinishedGoodId spans all three families but rejects anything else', () => {
    for (const id of ['FG-000001', 'FGHD-000001', 'FGTH-000001']) {
      expect(isFinishedGoodId(id)).toBe(true);
    }
    for (const id of ['MC-000001', 'PG-000001', 'RS-000001', 'nonsense']) {
      expect(isFinishedGoodId(id)).toBe(false);
    }
  });

  it('maps an id to the right sequence, and lists all three', () => {
    expect(seqForId('FG-000001')).toBe(FAMILY_META.FINISHED_GOOD.seq);
    expect(seqForId('FGHD-000001')).toBe(FAMILY_META.HARDENER.seq);
    expect(seqForId('FGTH-000001')).toBe(FAMILY_META.THINNER.seq);
    expect(FG_FAMILY_SEQUENCES).toEqual([
      'finished_good_unique_seq',
      'finished_good_hardener_seq',
      'finished_good_thinner_seq',
    ]);
  });

  it('every family sequence is distinct — no two families share a series', () => {
    const seqs = FG_FAMILY_SEQUENCES;
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('carton (PG-) ids are their own space, never a finished-goods code', () => {
    expect(formatCartonId(3)).toBe('PG-000003');
    expect(isCartonId('PG-000003')).toBe(true);
    expect(isCartonId('FG-000003')).toBe(false);
    expect(isFinishedGoodId('PG-000003')).toBe(false);
  });
});
