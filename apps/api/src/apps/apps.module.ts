import { Module } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { SlackClient } from './slack';
import { TeamsClient } from './teams';

/** Workspace apps (Slack, Microsoft Teams). Workflow steps reach them through AppsService. */
@Module({
  controllers: [AppsController],
  providers: [AppsService, SlackClient, TeamsClient],
  exports: [AppsService, SlackClient, TeamsClient],
})
export class AppsModule {}
