import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ProductionRequestController } from './production-request.controller';
import { ProductionRequestService } from './production-request.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ProductionRequestController],
  providers: [ProductionRequestService],
  exports: [ProductionRequestService], // Store inbox (Step 5) + Admin dashboard (Step 8) reuse it
})
export class ProductionRequestModule {}
