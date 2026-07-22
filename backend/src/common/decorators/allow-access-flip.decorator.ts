import { SetMetadata } from '@nestjs/common';

export const ALLOW_ACCESS_FLIP_KEY = 'allowAccessFlip';

/**
 * The FOURTH named door through OVERSIGHT's view-only rule: flipping an operational
 * access flag.
 *
 * Adding a door is not a weakening of the pattern — it IS the pattern. Every write the
 * owner genuinely needs gets its own decorator, its own two-sided guard, its own
 * controller and no @Roles, so the complete set stays enumerable and cannot grow
 * silently. The sweep in user-admin.spec.ts asserts the exact set; a fifth door fails it.
 *
 * Deliberately narrow: this grants setting STORE_INWARD_ACCESS and nothing else. It
 * confers no inward access on the owner and no ability to read an invoice he could not
 * already read.
 */
export const AllowAccessFlip = () => SetMetadata(ALLOW_ACCESS_FLIP_KEY, true);
