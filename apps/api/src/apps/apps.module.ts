import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { SlackClient } from './slack';
import { CardPaymentsClient } from './card-payments';
import { CardPaymentsController } from './card-payments.controller';
import { CardPaymentsService } from './card-payments.service';
import { DocusignClient } from './docusign';
import { NotificationsService } from '../notifications/notifications.service';
import { DocusignController } from './docusign.controller';
import { DocusignService } from './docusign.service';
import { TeamsClient } from './teams';
import { ZoomClient } from './zoom';
import { ZoomController } from './zoom.controller';
import { ZoomService } from './zoom.service';

/** Workspace apps (Slack, Microsoft Teams, Zoom, DocuSign, card payments). Workflow steps reach them through AppsService. */
@Module({
  imports: [CrmModule],
  controllers: [ZoomController, DocusignController, CardPaymentsController, AppsController],
  providers: [AppsService, SlackClient, TeamsClient, ZoomClient, ZoomService, DocusignClient, DocusignService, CardPaymentsClient, CardPaymentsService, NotificationsService],
  exports: [AppsService, SlackClient, TeamsClient, ZoomClient, ZoomService, DocusignClient, DocusignService, CardPaymentsService],
})
export class AppsModule {}
