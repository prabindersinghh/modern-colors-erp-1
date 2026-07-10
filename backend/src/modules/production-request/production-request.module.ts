import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { ProductionRequestController } from './production-request.controller';
import { ProductionRequestService } from './production-request.service';

@Module({
  imports: [PrismaModule, AuditModule, StockModule], // StockModule → oversight overview (Step 8)
  controllers: [ProductionRequestController],
  providers: [ProductionRequestService],
  exports: [ProductionRequestService], // Store inbox (Step 5) + Admin dashboard (Step 8) reuse it
})
export class ProductionRequestModule {}
