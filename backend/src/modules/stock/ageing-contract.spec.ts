import { AGEING, ageingLevel } from './fifo.util';

/**
 * Locks the FIFO ageing thresholds that the UI's severity colours depend on.
 *
 * The Paint Chip design system added `ageingSeverity()` in
 * `frontend/src/components/ui/severity.tsx`, which maps stock age onto the
 * critical/warning/healthy colour language. It hard-codes the SAME 30/60-day
 * boundaries as this server-side rule, because a colour has to mean the same
 * thing as the value it is describing.
 *
 * That duplication is deliberate (the frontend cannot import from the backend),
 * but it can silently drift: change AGEING here and the floor would keep seeing
 * amber on stock the server now considers old. This test makes that drift a
 * failing build rather than a wrong colour on a factory phone.
 *
 * If you change a threshold, update BOTH:
 *   - backend/src/modules/stock/fifo.util.ts  (AGEING)
 *   - frontend/src/components/ui/severity.tsx (ageingSeverity)
 */
describe('FIFO ageing thresholds (UI severity contract)', () => {
  it('keeps the amber/red boundaries the UI colours are built on', () => {
    expect(AGEING.AMBER_DAYS).toBe(30);
    expect(AGEING.RED_DAYS).toBe(60);
  });

  it('classifies each side of both boundaries', () => {
    // healthy (green in the UI)
    expect(ageingLevel(0)).toBe('FRESH');
    expect(ageingLevel(29)).toBe('FRESH');
    // warning (amber) — boundary is inclusive
    expect(ageingLevel(30)).toBe('AMBER');
    expect(ageingLevel(59)).toBe('AMBER');
    // critical (red) — boundary is inclusive
    expect(ageingLevel(60)).toBe('RED');
    expect(ageingLevel(365)).toBe('RED');
  });

  it('never returns a level the UI has no colour for', () => {
    const known = new Set(['FRESH', 'AMBER', 'RED']);
    for (const d of [-5, 0, 1, 29, 30, 31, 59, 60, 61, 1000]) {
      expect(known.has(ageingLevel(d))).toBe(true);
    }
  });
});
