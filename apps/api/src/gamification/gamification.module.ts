import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';

/** Enhancement feature 14: sales gamification computed from CRM records under admin-configured rules. */
@Module({
  controllers: [GamificationController],
  providers: [GamificationService, NotificationsService],
  exports: [GamificationService],
})
export class GamificationModule {}
