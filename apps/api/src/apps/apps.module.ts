import { Module } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { SlackClient } from './slack';

/** Workspace apps (Slack first). Workflow steps reach them through AppsService. */
@Module({
  controllers: [AppsController],
  providers: [AppsService, SlackClient],
  exports: [AppsService, SlackClient],
})
export class AppsModule {}
