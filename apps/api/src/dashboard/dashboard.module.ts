import { Module } from '@nestjs/common';
import { DashboardChartsService } from './dashboard-charts.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ controllers: [DashboardController], providers: [DashboardService, DashboardChartsService] })
export class DashboardModule {}
