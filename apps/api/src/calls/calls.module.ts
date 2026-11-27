import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { CrmModule } from '../crm/crm.module';
import { CallsController, CallsEventsController, CallsTwilioController } from './calls.controller';
import { CallsService } from './calls.service';
import { ApiAdapter, DialerAdapters, TwilioAdapter } from './dialer-adapters';
import { DialersService } from './dialers.service';

/**
 * The Calls section (ADR 0088) and the universal dialer (ADR 0089): dialers of any provider through one adapter
 * interface, placing and logging calls, provider events, recordings and the call history.
 */
@Module({
  imports: [CrmModule, AppsModule],
  controllers: [CallsTwilioController, CallsEventsController, CallsController],
  providers: [CallsService, DialersService, DialerAdapters, ApiAdapter, TwilioAdapter],
})
export class CallsModule {}
