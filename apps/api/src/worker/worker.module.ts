import { AppsModule } from '../apps/apps.module';
import { CommercialModule } from '../commercial/commercial.module';
import { RevenueModule } from '../revenue/revenue.module';
import { BillingModule } from '../billing/billing.module';
import { Module } from '@nestjs/common';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { AiModule } from '../ai/ai.module';
import { GamificationModule } from '../gamification/gamification.module';
import { VisitorsModule } from '../visitors/visitors.module';
import { ProspectsModule } from '../prospects/prospects.module';
import { AutomationModule } from '../automation/automation.module';
import { SequencesModule } from '../sequences/sequences.module';
import { WorkerService } from './worker.service';

/** The background loop over every queue (Phase 3 automation plus Phase 4 queued agent runs). */
@Module({
  imports: [AppsModule, AutomationModule, AiModule, CommercialModule, RevenueModule, BillingModule, SequencesModule, IntelligenceModule, GamificationModule, VisitorsModule, ProspectsModule],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
