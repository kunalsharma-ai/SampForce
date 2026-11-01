import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { ApiKeysController, ZapierController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

/** Workspace API keys (Zapier, Make, n8n, scripts) and the Zapier REST-hook endpoints. */
@Module({
  imports: [CrmModule],
  controllers: [ApiKeysController, ZapierController],
  providers: [ApiKeysService],
})
export class ApiKeysModule {}
