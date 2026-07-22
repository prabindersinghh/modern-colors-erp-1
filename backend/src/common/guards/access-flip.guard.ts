import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ALLOW_ACCESS_FLIP_KEY } from '../decorators/allow-access-flip.decorator';

/**
 * The access-flip permission — two-sided exactly like the other three named doors:
 * it refuses an UNMARKED handler even for OVERSIGHT, and passes only OVERSIGHT on a
 * marked one.
 */
@Injectable()
export class AccessFlipGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const marked = this.reflector.getAllAndOverride<boolean>(ALLOW_ACCESS_FLIP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!marked) throw new ForbiddenException('This route is not an access-flip endpoint.');
    const { user } = context.switchToHttp().getRequest();
    if (!user || user.role !== Role.OVERSIGHT) {
      throw new ForbiddenException('Only the factory Admin may change access flags.');
    }
    return true;
  }
}
