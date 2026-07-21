import { SetMetadata } from '@nestjs/common';

export const ALLOW_CORRECTION_KEY = 'allowCorrection';

/**
 * Marks the ONE route class of endpoint the view-only Admin (OVERSIGHT) may call: an
 * audited data CORRECTION. This is deliberately a separate mechanism from @Roles so the
 * structural guarantee "OVERSIGHT appears in no mutating @Roles list" stays true and
 * machine-checkable — the exception is its own named permission, not a role grant.
 *
 * Enforced by CorrectionsGuard, which refuses any handler NOT carrying this marker, so
 * the guard can never accidentally open another route.
 */
export const AllowCorrection = () => SetMetadata(ALLOW_CORRECTION_KEY, true);
