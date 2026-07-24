import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ScanSessionService } from './scan-session.service';
import { ScanSessionController } from './scan-session.controller';

/** Global so receiving and dispatch can enforce the gate without importing the module. */
@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ScanSessionController],
  providers: [ScanSessionService],
  exports: [ScanSessionService],
})
export class ScanSessionModule {}
