import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { CrmModule } from '../crm/crm.module';
import { EmailAnalyticsService } from './analytics.service';
import { SequenceRunner } from './sequence-runner.service';
import { EmailTemplatesController, EmailVariablesController, SequencesController, TrackingController } from './sequences.controller';
import { SequencesService } from './sequences.service';
import { EmailVariablesService, TemplatesService } from './templates.service';

/** Phase 9: email templates, sequences, recipient events and the do-not-email list. */
@Module({
  imports: [CrmModule, AutomationModule],
  controllers: [EmailTemplatesController, EmailVariablesController, SequencesController, TrackingController],
  providers: [TemplatesService, EmailVariablesService, EmailAnalyticsService, SequencesService, SequenceRunner],
  exports: [SequencesService, SequenceRunner],
})
export class SequencesModule {}
