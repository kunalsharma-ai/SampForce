import { Global, Module } from '@nestjs/common';
import { SECRET_BOX, SecretBox } from './crypto';
import { API_ENV, type ApiEnv, envProvider } from './env';
import { PrismaService } from './prisma.service';
import { ProviderKeysService } from './provider-keys';
import { WebhookReceipts } from './webhook-receipts';

const secretBoxProvider = { provide: SECRET_BOX, useFactory: (env: ApiEnv) => new SecretBox(env), inject: [API_ENV] };

@Global()
@Module({ providers: [envProvider, PrismaService, secretBoxProvider, ProviderKeysService, WebhookReceipts], exports: [envProvider, PrismaService, secretBoxProvider, ProviderKeysService, WebhookReceipts] })
export class CommonModule {}
