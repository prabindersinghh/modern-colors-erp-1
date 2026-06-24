import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    // Feature modules are added here as they are built:
    // AuthModule, UsersModule, CatalogueModule, SettingsModule,
    // PurchaseOrderModule, AiExtractionModule, MaterialModule, QrModule,
    // ReceivingModule, DashboardModule, AuditModule
  ],
})
export class AppModule {}
