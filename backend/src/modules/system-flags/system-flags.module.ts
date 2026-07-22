import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { SystemFlagsService } from './system-flags.service';
import { SystemFlagsController, SystemFlagsAdminController } from './system-flags.controller';
import { StoreInwardGuard } from '../../common/guards/store-inward.guard';

/** Global: StoreInwardGuard is applied in several feature modules and needs the service. */
@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [SystemFlagsController, SystemFlagsAdminController],
  providers: [SystemFlagsService, StoreInwardGuard],
  exports: [SystemFlagsService, StoreInwardGuard],
})
export class SystemFlagsModule {}
