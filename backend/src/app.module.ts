import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { validateEnv } from './config/env.validation';
import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AiExtractionModule } from './modules/ai-extraction/ai-extraction.module';
import { PurchaseOrderModule } from './modules/purchase-order/purchase-order.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    StorageModule,
    AuditModule,
    UsersModule,
    AuthModule,
    CatalogueModule,
    SettingsModule,
    AiExtractionModule,
    PurchaseOrderModule,
    // Added as they are built:
    // MaterialModule, QrModule, ReceivingModule, DashboardModule
  ],
})
export class AppModule {}
