import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { CardPaymentsClient } from './card-payments';
import { CardPaymentsController } from './card-payments.controller';
import { CardPaymentsService } from './card-payments.service';
import { DocusignClient } from './docusign';
import { NotificationsService } from '../notifications/notifications.service';
import { DocusignController } from './docusign.controller';
import { DocusignService } from './docusign.service';
import { WhatsappClient } from './whatsapp';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { TwilioClient } from './twilio';
import { TwilioController } from './twilio.controller';
import { TwilioService } from './twilio.service';
import { SampbidxClient } from './sampbidx';
import { SampbidxController } from './sampbidx.controller';
import { SampbidxService } from './sampbidx.service';
import { SampbidxChatCallbackController, SampbidxChatController } from './sampbidx-chat.controller';
import { SampbidxChatService } from './sampbidx-chat.service';
import { ChatModule } from '../chat/chat.module';

/** Workspace apps (DocuSign, card payments, WhatsApp, SMS through Twilio, SampBidx). Workflow steps reach them through AppsService. */
@Module({
  imports: [CrmModule, ChatModule],
  controllers: [DocusignController, CardPaymentsController, WhatsappController, TwilioController, SampbidxChatController, SampbidxChatCallbackController, SampbidxController, AppsController],
  providers: [AppsService, DocusignClient, DocusignService, CardPaymentsClient, CardPaymentsService, WhatsappClient, WhatsappService, TwilioClient, TwilioService, SampbidxClient, SampbidxService, SampbidxChatService, NotificationsService],
  exports: [AppsService, TwilioClient, DocusignClient, DocusignService, CardPaymentsService, WhatsappService, TwilioService, SampbidxService, SampbidxChatService],
})
export class AppsModule {}
