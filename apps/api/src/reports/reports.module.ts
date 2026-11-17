import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { ImmersiveService } from './immersive.service';
import { DashboardsController, ImmersiveController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [CrmModule],
  controllers: [ReportsController, DashboardsController, ImmersiveController],
  providers: [ReportsService, ImmersiveService],
})
export class ReportsModule {}
