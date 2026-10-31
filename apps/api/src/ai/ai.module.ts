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
import { ForecastService } from './forecast.service';
import { AI_PROVIDER, AiGateway, providerFactory } from './gateway.service';
import { RecordContextBuilder } from './record-context';

/** Phase 4: AI gateway, Copilot, agents and forecasting. */
@Module({
  imports: [CrmModule, IntelligenceModule],
  controllers: [AiController, ForecastController],
  providers: [
    { provide: AI_PROVIDER, inject: [API_ENV], useFactory: (env: ApiEnv) => providerFactory(env) },
    AiGateway,
    AiService,
    RecordContextBuilder,
    ForecastService,
    CopilotTools,
    CopilotService,
    AgentsService,
    AiRunner,
  ],
  exports: [AiRunner, AiGateway],
})
export class AiModule {}
