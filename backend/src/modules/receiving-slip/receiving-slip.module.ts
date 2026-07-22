import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ReceivingSlipService } from './receiving-slip.service';
import { ReceivingSlipController, InwardsController } from './receiving-slip.controller';

/**
 * Exported so the purchase-order module can generate a slip INSIDE the confirm
 * transaction — a registered inward always has a slip, with no window in between.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ReceivingSlipController, InwardsController],
  providers: [ReceivingSlipService],
  exports: [ReceivingSlipService],
})
export class ReceivingSlipModule {}
