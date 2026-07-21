import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../common/storage/storage.module';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [HandoverController],
  providers: [HandoverService],
})
export class HandoverModule {}
