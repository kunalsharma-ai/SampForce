import { Global, Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { NotificationsService } from '../notifications/notifications.service';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { TaskPlansController } from './task-plans.controller';
import { TaskPlansService } from './task-plans.service';

/** Recurring tasks and performance ranking (ADR 0096). Global, so the worker can run the task sweep. */
@Global()
@Module({
  imports: [CrmModule, WorkspacesModule],
  controllers: [TaskPlansController, PerformanceController],
  providers: [TaskPlansService, PerformanceService, NotificationsService],
  exports: [TaskPlansService],
})
export class TaskPlansModule {}
