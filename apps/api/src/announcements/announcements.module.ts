import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

/** Announcements to the whole organisation (ADR 0072, M8). */
@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, NotificationsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
