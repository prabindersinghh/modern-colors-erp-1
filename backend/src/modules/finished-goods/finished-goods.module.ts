import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { QrModule } from '../qr/qr.module';
import { FinishedGoodsController } from './finished-goods.controller';
import { FgCorrectionsController } from './fg-corrections.controller';
import { FinishedGoodsService } from './finished-goods.service';
import { DispatchService } from './dispatch.service';
import { ReturnsService } from './returns.service';

@Module({
  imports: [PrismaModule, AuditModule, QrModule],
  controllers: [FinishedGoodsController, FgCorrectionsController],
  providers: [FinishedGoodsService, DispatchService, ReturnsService],
  exports: [FinishedGoodsService, DispatchService, ReturnsService],
})
export class FinishedGoodsModule {}
