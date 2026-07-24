import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { LabelReprintModule } from '../label-reprint/label-reprint.module';
import { PackingController } from './packing.controller';
import { PackingService } from './packing.service';

@Module({
  imports: [PrismaModule, AuditModule, LabelReprintModule],
  controllers: [PackingController],
  providers: [PackingService],
  exports: [PackingService],
})
export class PackingModule {}
