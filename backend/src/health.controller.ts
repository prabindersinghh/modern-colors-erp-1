import { Controller, Get, Query } from '@nestjs/common';
import { StorageService } from './common/storage/storage.service';

// Public liveness endpoint for the host's health checks. No auth.
@Controller('health')
export class HealthController {
  constructor(private readonly storage: StorageService) {}

  @Get()
  check() {
    return { status: 'ok', service: 'modern-colours-api', time: new Date().toISOString() };
  }

  /**
   * Storage probe, deep check opt-in via ?deep=1.
   *
   * The round-trip is opt-in because the host polls health constantly and a write on
   * every poll would be wasteful. When invoice upload breaks, this answers "is it
   * storage, and why" in a single request — the question that cost real diagnosis time
   * during the 500-on-upload incident.
   *
   * Reports configuration state and reachability only. Credentials are never returned.
   */
  @Get('storage')
  async storageHealth(@Query('deep') deep?: string) {
    if (deep === '1' || deep === 'true') {
      const result = await this.storage.healthCheck();
      return { status: result.ok ? 'ok' : 'degraded', storage: result };
    }
    return {
      status: 'ok',
      hint: 'Add ?deep=1 to run a real write/read round-trip against the storage backend.',
    };
  }
}
