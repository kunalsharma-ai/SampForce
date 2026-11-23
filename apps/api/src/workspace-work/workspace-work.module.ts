import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignedTasksService } from './assigned-tasks.service';
import { TargetsService } from './targets.service';
import { AssignedTasksController, TargetsController } from './workspace-work.controller';

@Module({
  imports: [CrmModule],
  controllers: [TargetsController, AssignedTasksController],
  providers: [TargetsService, AssignedTasksService, NotificationsService],
})
export class WorkspaceWorkModule {}
