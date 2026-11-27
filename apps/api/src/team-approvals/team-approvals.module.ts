import { Global, Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { RecycleBinService } from './recycle-bin.service';
import { DeletedItemsController, TeamApprovalsController } from './team-approvals.controller';
import { TeamApprovalsService } from './team-approvals.service';

/** Team approvals and deleted items (ADR 0097). Global: the app-wide guard and interceptor use these services. */
@Global()
@Module({
  controllers: [TeamApprovalsController, DeletedItemsController],
  providers: [TeamApprovalsService, RecycleBinService, NotificationsService],
  exports: [TeamApprovalsService, RecycleBinService],
})
export class TeamApprovalsModule {}
