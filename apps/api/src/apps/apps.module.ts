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
import { WhatsappClient } from './whatsapp';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { TwilioClient } from './twilio';
import { TwilioController } from './twilio.controller';
import { TwilioService } from './twilio.service';

/** Workspace apps (Slack, Microsoft Teams, Zoom, DocuSign, card payments, WhatsApp, SMS through Twilio). Workflow steps reach them through AppsService. */
@Module({
  imports: [CrmModule],
  controllers: [ZoomController, DocusignController, CardPaymentsController, WhatsappController, TwilioController, AppsController],
  providers: [AppsService, SlackClient, TeamsClient, ZoomClient, ZoomService, DocusignClient, DocusignService, CardPaymentsClient, CardPaymentsService, WhatsappClient, WhatsappService, TwilioClient, TwilioService, NotificationsService],
  exports: [AppsService, SlackClient, TeamsClient, ZoomClient, ZoomService, DocusignClient, DocusignService, CardPaymentsService, WhatsappService, TwilioService],
})
export class AppsModule {}
