import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  SystemFlagsService,
  STORE_INWARD_ACCESS,
  FLAG_ON,
  FLAG_OFF,
} from '../../modules/system-flags/system-flags.service';

/**
 * The reversible half of the segregation-of-duties cutover.
 *
 * Runs AFTER RolesGuard on the inward routes. It affects the STORE DESK AND NOBODY
 * ELSE: whatever the flag says, Gate (OPERATOR), Oversight, Supervisor and every other
 * role are returned unchanged. That single-role scope is what makes the flip safe to
 * rehearse against production — flipping it off can never stop a truck being received,
 * because receiving belongs to Gate.
 *
 * The flag defaults ON and an unreadable database also reads ON, so neither deploying
 * this guard nor a transient outage can revoke anything on its own.
 */
@Injectable()
export class StoreInwardGuard implements CanActivate {
  constructor(private readonly flags: SystemFlagsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    // Only the Store desk is governed by this flag. Gate must be untouched in BOTH
    // states — asserted in store-inward-flip.spec.ts.
    if (!user || user.role !== Role.ADMIN) return true;

    const value = await this.flags.get(STORE_INWARD_ACCESS, FLAG_ON);
    if (value === FLAG_OFF) {
      throw new ForbiddenException(
        'The inward flow has moved to the Gate desk. Store no longer uploads invoices, reviews them, or prints QR labels — the gate hands over a receiving slip instead.',
      );
    }
    return true;
  }
}
