import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { CrmModule } from '../crm/crm.module';
import { SequenceRunner } from './sequence-runner.service';
import { EmailTemplatesController, SequencesController, TrackingController } from './sequences.controller';
import { SequencesService } from './sequences.service';
import { TemplatesService } from './templates.service';

/** Phase 9: email templates, sequences, recipient events and the do-not-email list. */
@Module({
  imports: [CrmModule, AutomationModule],
  controllers: [EmailTemplatesController, SequencesController, TrackingController],
  providers: [TemplatesService, SequencesService, SequenceRunner],
  exports: [SequencesService, SequenceRunner],
})
export class SequencesModule {}
