import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ALLOW_CORRECTION_KEY } from '../decorators/allow-correction.decorator';

/**
 * The corrections permission — the narrow, explicit exception to OVERSIGHT's
 * structural view-only guarantee.
 *
 * Two-sided by design:
 *  - it passes ONLY for handlers explicitly marked @AllowCorrection() — attaching this
 *    guard to an unmarked route locks the route rather than opening it;
 *  - it passes ONLY the OVERSIGHT role — corrections are the factory owner's act.
 *
 * OVERSIGHT still appears in no mutating @Roles list anywhere (asserted by
 * fg-corrections.spec.ts), so the view-only rule stays machine-checked; this guard is
 * the single, named door through it.
 */
@Injectable()
export class CorrectionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const marked = this.reflector.getAllAndOverride<boolean>(ALLOW_CORRECTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!marked) {
      throw new ForbiddenException('This route is not a correction endpoint.');
    }
    const { user } = context.switchToHttp().getRequest();
    if (!user || user.role !== Role.OVERSIGHT) {
      throw new ForbiddenException('Only the factory Admin may record corrections.');
    }
    return true;
  }
}
