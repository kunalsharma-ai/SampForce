import { Global, Module } from '@nestjs/common';
import { SECRET_BOX, SecretBox } from './crypto';
import { API_ENV, type ApiEnv, envProvider } from './env';
import { PrismaService } from './prisma.service';

const secretBoxProvider = { provide: SECRET_BOX, useFactory: (env: ApiEnv) => new SecretBox(env), inject: [API_ENV] };

@Global()
@Module({ providers: [envProvider, PrismaService, secretBoxProvider], exports: [envProvider, PrismaService, secretBoxProvider] })
export class CommonModule {}
