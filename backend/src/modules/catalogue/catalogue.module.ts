import { Module } from '@nestjs/common';
import { CatalogueService } from './catalogue.service';
import { CatalogueController } from './catalogue.controller';
import { CatalogueValidationService } from './catalogue-validation.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  // SettingsModule provides getDecryptedKey() for the optional AI validation pass —
  // the same mechanism PO extraction uses, so the client's own key serves both.
  imports: [SettingsModule],
  controllers: [CatalogueController],
  providers: [CatalogueService, CatalogueValidationService],
  exports: [CatalogueService],
})
export class CatalogueModule {}
