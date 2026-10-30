import { Module } from '@nestjs/common';
import { ImmersiveService } from './immersive.service';
import { DashboardsController, ImmersiveController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController, DashboardsController, ImmersiveController],
  providers: [ReportsService, ImmersiveService],
})
export class ReportsModule {}
