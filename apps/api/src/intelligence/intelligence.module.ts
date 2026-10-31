import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { NotificationsService } from '../notifications/notifications.service';
import { DealHealthService } from './deal-health.service';
import { InsightsService } from './insights.service';
import { IntelligenceController } from './intelligence.controller';
import { NextActionsService } from './next-actions.service';
import { RecordIntelligenceService } from './record-intelligence.service';
import { TimelineService } from './timeline.service';

/**
 * Enhancement Phase 1 (AI sales intelligence, Customer 360, next best action, deal health monitor). Built on the
 * existing CRM, scoring rules and Copilot: no second AI engine. Copilot reads these services through its tools.
 */
@Module({
  imports: [CrmModule],
  controllers: [IntelligenceController],
  providers: [DealHealthService, NextActionsService, TimelineService, InsightsService, RecordIntelligenceService, NotificationsService],
  exports: [DealHealthService, NextActionsService, InsightsService, RecordIntelligenceService],
})
export class IntelligenceModule {}
