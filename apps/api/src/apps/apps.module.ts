import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { SlackClient } from './slack';
import { DocusignClient } from './docusign';
import { DocusignController } from './docusign.controller';
import { DocusignService } from './docusign.service';
import { TeamsClient } from './teams';
import { ZoomClient } from './zoom';
import { ZoomController } from './zoom.controller';
import { ZoomService } from './zoom.service';

/** Workspace apps (Slack, Microsoft Teams, Zoom, DocuSign). Workflow steps reach them through AppsService. */
@Module({
  imports: [CrmModule],
  controllers: [ZoomController, DocusignController, AppsController],
  providers: [AppsService, SlackClient, TeamsClient, ZoomClient, ZoomService, DocusignClient, DocusignService],
  exports: [AppsService, SlackClient, TeamsClient, ZoomClient, ZoomService, DocusignClient, DocusignService],
})
export class AppsModule {}
