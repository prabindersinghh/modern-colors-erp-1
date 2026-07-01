import { Controller, Get } from '@nestjs/common';

// Public liveness endpoint for the host's health checks (Render). No auth.
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: 'modern-colours-api', time: new Date().toISOString() };
  }
}
