import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { NotificationsService } from '../notifications/notifications.service';
import { WebsiteEnquiriesController, WebsiteEnquiryHookController } from './website-enquiries.controller';
import { WebsiteEnquiriesService } from './website-enquiries.service';
import { WebsiteEnquirySync } from './website-enquiry-sync.service';

/** Website Enquiry (ADR 0095): the company website's enquiries, sign-ups and reviews; replaces Website Visitors. */
@Module({
  imports: [CrmModule],
  controllers: [WebsiteEnquiriesController, WebsiteEnquiryHookController],
  providers: [WebsiteEnquiriesService, WebsiteEnquirySync, NotificationsService],
  exports: [WebsiteEnquiriesService, WebsiteEnquirySync],
})
export class WebsiteEnquiriesModule {}
