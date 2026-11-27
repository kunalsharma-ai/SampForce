import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { LearningCertificatesService } from './certificates.service';
import { LearningFilesService } from './files.service';
import { LearningLearnerService } from './learner.service';
import { LearningController, LearningVerifyController } from './learning.controller';
import { LearningManageService } from './manage.service';
import { LearningModulesService } from './modules.service';
import { LearningRemindersService } from './reminders.service';

/** Learning & Development (ADR 0097). */
@Module({
  controllers: [LearningController, LearningVerifyController],
  providers: [LearningModulesService, LearningFilesService, LearningLearnerService, LearningManageService, LearningCertificatesService, LearningRemindersService, NotificationsService],
  exports: [LearningRemindersService],
})
export class LearningModule {}
