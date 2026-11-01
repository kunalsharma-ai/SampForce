import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { SlackClient } from './slack';
import { TeamsClient } from './teams';
import { ZoomClient } from './zoom';
import { ZoomController } from './zoom.controller';
import { ZoomService } from './zoom.service';

/** Workspace apps (Slack, Microsoft Teams, Zoom). Workflow steps reach them through AppsService. */
@Module({
  imports: [CrmModule],
  controllers: [ZoomController, AppsController],
  providers: [AppsService, SlackClient, TeamsClient, ZoomClient, ZoomService],
  exports: [AppsService, SlackClient, TeamsClient, ZoomClient, ZoomService],
})
export class AppsModule {}
