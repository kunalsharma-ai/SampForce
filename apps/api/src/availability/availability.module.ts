import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityService, NotificationsService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
