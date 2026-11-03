import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { BillingController, PublicPricingController, WorkspaceController } from './billing.controller';
import { BillingProviders } from './billing-providers';
import { BillingService } from './billing.service';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [BillingController, WorkspaceController, PublicPricingController],
  providers: [BillingService, BillingProviders, WorkspaceService, NotificationsService],
  exports: [BillingService, BillingProviders],
})
export class BillingModule {}
