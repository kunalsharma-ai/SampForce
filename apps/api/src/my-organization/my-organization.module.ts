import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { MyOrganizationController, OrgSharedController } from './my-organization.controller';
import { MyOrganizationService } from './my-organization.service';
import { OrgExpiryRemindersService } from './org-expiry-reminders.service';
import { OrgSharesService } from './org-shares.service';

/** My Organization (ADR 0100): the organisation's own profile, documents, credentials and client shares. */
@Module({
  controllers: [MyOrganizationController, OrgSharedController],
  providers: [MyOrganizationService, OrgSharesService, OrgExpiryRemindersService, NotificationsService],
  exports: [OrgExpiryRemindersService],
})
export class MyOrganizationModule {}
