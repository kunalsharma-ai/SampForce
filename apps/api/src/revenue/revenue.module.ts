import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { NotificationsService } from '../notifications/notifications.service';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController, SuccessController } from './revenue.controller';
import { SuccessService } from './success.service';

@Module({
  imports: [CrmModule],
  controllers: [AnalyticsController, SuccessController],
  providers: [AnalyticsService, SuccessService, NotificationsService],
  exports: [SuccessService],
})
export class RevenueModule {}
