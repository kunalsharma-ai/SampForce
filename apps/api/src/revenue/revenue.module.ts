import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController, SuccessController } from './revenue.controller';
import { SuccessService } from './success.service';

@Module({
  controllers: [AnalyticsController, SuccessController],
  providers: [AnalyticsService, SuccessService, NotificationsService],
  exports: [SuccessService],
})
export class RevenueModule {}
