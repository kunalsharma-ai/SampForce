import { Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../common/env';
import { CrmModule } from '../crm/crm.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { AgentsService } from './agents.service';
import { AiController, ForecastController } from './ai.controller';
import { AiRunner } from './ai-runner.service';
import { AiService } from './ai.service';
import { CopilotTools } from './copilot-tools';
import { CopilotService } from './copilot.service';
import { EmailAssistantService } from './email-assistant.service';
import { ForecastPlanService } from './forecast-plan.service';
import { ForecastService } from './forecast.service';
import { AI_PROVIDER, AiGateway, providerFactory } from './gateway.service';
import { RecordContextBuilder } from './record-context';
import { DeepgramClient } from '../meetings/deepgram';
import { MeetingRecordsController } from '../meetings/meeting-records.controller';
import { MeetingRecordsService } from '../meetings/meeting-records.service';
import { VoiceNotesController } from '../voice/voice-notes.controller';
import { VoiceNotesService } from '../voice/voice-notes.service';

/** Phase 4: AI gateway, Copilot, agents and forecasting. */
@Module({
  imports: [CrmModule, IntelligenceModule],
  controllers: [AiController, ForecastController, MeetingRecordsController, VoiceNotesController],
  providers: [
    { provide: AI_PROVIDER, inject: [API_ENV], useFactory: (env: ApiEnv) => providerFactory(env) },
    AiGateway,
    AiService,
    RecordContextBuilder,
    ForecastService,
    ForecastPlanService,
    CopilotTools,
    CopilotService,
    AgentsService,
    EmailAssistantService,
    AiRunner,
    DeepgramClient,
    MeetingRecordsService,
    VoiceNotesService,
  ],
  exports: [AiRunner, AiGateway],
})
export class AiModule {}
