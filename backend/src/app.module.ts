import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { validateEnv } from './config/env.validation';
import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AiExtractionModule } from './modules/ai-extraction/ai-extraction.module';
import { QrModule } from './modules/qr/qr.module';
import { MaterialModule } from './modules/material/material.module';
import { PurchaseOrderModule } from './modules/purchase-order/purchase-order.module';
import { ReceivingModule } from './modules/receiving/receiving.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ProductionRequestModule } from './modules/production-request/production-request.module';

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
    QrModule,
    MaterialModule,
    PurchaseOrderModule,
    ReceivingModule,
    DashboardModule,
    ProductionRequestModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
