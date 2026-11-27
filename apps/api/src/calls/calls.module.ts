import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { CrmModule } from '../crm/crm.module';
import { CallsController, CallsTwilioController } from './calls.controller';
import { CallsService } from './calls.service';
import { NotificationsService } from '../notifications/notifications.service';

/** The Calls section (ADR 0088): personal dialers, placing and logging calls, the call history. */
@Module({
  imports: [CrmModule, AppsModule],
  controllers: [CallsTwilioController, CallsController],
  providers: [CallsService, NotificationsService],
})
export class CallsModule {}
