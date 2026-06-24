import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AiExtractionService } from './ai-extraction.service';

@Module({
  imports: [SettingsModule], // for SettingsService.getDecryptedKey()
  providers: [AiExtractionService],
  exports: [AiExtractionService],
})
export class AiExtractionModule {}
