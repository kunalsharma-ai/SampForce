import { ConsoleNotificationsModule } from '../operator/console-notifications.module';
import { OperatorModule } from '../operator/operator.module';
import { AppsModule } from '../apps/apps.module';
import { CommercialModule } from '../commercial/commercial.module';
import { RevenueModule } from '../revenue/revenue.module';
import { BillingModule } from '../billing/billing.module';
import { Module } from '@nestjs/common';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { AiModule } from '../ai/ai.module';
import { GamificationModule } from '../gamification/gamification.module';
import { WebsiteEnquiriesModule } from '../website-enquiries/website-enquiries.module';
import { ProspectsModule } from '../prospects/prospects.module';
import { AutomationModule } from '../automation/automation.module';
import { SequencesModule } from '../sequences/sequences.module';
import { CompanyLogosService } from '../crm/company-logos.service';
import { HunterClient } from '../finder/hunter';
import { CompanyEnrichmentService } from '../crm/company-enrichment.service';
import { CrmRemindersService } from '../crm/crm-reminders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MobileModule } from '../mobile/mobile.module';
import { CompanyClosureService } from '../tenants/company-closure.service';
import { WorkerService } from './worker.service';

/** The background loop over every queue (Phase 3 automation plus Phase 4 queued agent runs). */
@Module({
  imports: [ConsoleNotificationsModule, OperatorModule, AppsModule, AutomationModule, AiModule, CommercialModule, RevenueModule, BillingModule, SequencesModule, IntelligenceModule, GamificationModule, WebsiteEnquiriesModule, ProspectsModule, MobileModule],
  providers: [WorkerService, CrmRemindersService, CompanyLogosService, CompanyEnrichmentService, HunterClient, NotificationsService, CompanyClosureService],
  exports: [WorkerService],
})
export class WorkerModule {}
