import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AutomationModule } from '../automation/automation.module';
import { WorkerService } from './worker.service';

/** The background loop over every queue (Phase 3 automation plus Phase 4 queued agent runs). */
@Module({
  imports: [AutomationModule, AiModule],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
