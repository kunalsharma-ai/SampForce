import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { CrmModule } from '../crm/crm.module';
import { CommunicationService } from '../integrations/communication.service';
import { CommunicationController, InboxController, IntegrationsController } from '../integrations/integrations.controller';
import { InboxService } from '../integrations/inbox.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { NotificationsController } from '../notifications/notifications.controller';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhookDeliverer } from '../webhooks/delivery.service';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { WebhooksService } from '../webhooks/webhooks.service';
import { WorkflowActions } from './actions.service';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController, WorkflowsController } from './automation.controller';
import { EventRelay } from './event-relay.service';
import { WorkflowExecutor } from './executor.service';
import { AutomationRecords } from './records';
import { WorkflowsService } from './workflows.service';

/** Phase 3: outbox relay, workflow engine, approvals, notifications, webhooks and mailbox integrations. */
@Module({
  imports: [CrmModule, AppsModule],
  controllers: [WorkflowsController, ApprovalsController, NotificationsController, WebhooksController, IntegrationsController, CommunicationController, InboxController],
  providers: [
    AutomationRecords,
    WorkflowActions,
    WorkflowExecutor,
    WorkflowsService,
    ApprovalsService,
    EventRelay,
    NotificationsService,
    WebhooksService,
    WebhookDeliverer,
    IntegrationsService,
    CommunicationService,
    InboxService,
  ],
  exports: [EventRelay, WorkflowExecutor, WebhookDeliverer, ApprovalsService, IntegrationsService, CommunicationService, NotificationsService],
})
export class AutomationModule {}
