import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AssignedTasksService } from './assigned-tasks.service';
import { WorkspaceDashboardService } from './dashboard.service';
import { TargetsService } from './targets.service';
import { AssignedTasksController, TargetsController, WorkspaceDashboardController } from './workspace-work.controller';

@Module({
  imports: [CrmModule, WorkspacesModule],
  controllers: [TargetsController, AssignedTasksController, WorkspaceDashboardController],
  providers: [TargetsService, AssignedTasksService, WorkspaceDashboardService, NotificationsService],
})
export class WorkspaceWorkModule {}
