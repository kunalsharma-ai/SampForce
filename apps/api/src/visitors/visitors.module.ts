import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PublicTrackingController, VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';

/** Enhancement feature 15: consent-aware website visitor intelligence. */
@Module({
  controllers: [VisitorsController, PublicTrackingController],
  providers: [VisitorsService, NotificationsService],
  exports: [VisitorsService],
})
export class VisitorsModule {}
