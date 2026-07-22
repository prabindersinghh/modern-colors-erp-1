import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { AiExtractionModule } from '../ai-extraction/ai-extraction.module';
import { MaterialModule } from '../material/material.module';
import { ReceivingSlipModule } from '../receiving-slip/receiving-slip.module';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderController } from './purchase-order.controller';

@Module({
  imports: [CatalogueModule, AiExtractionModule, MaterialModule, ReceivingSlipModule],
  controllers: [PurchaseOrderController],
  providers: [PurchaseOrderService],
  exports: [PurchaseOrderService],
})
export class PurchaseOrderModule {}
