import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { HunterClient } from '../finder/hunter';
import { DeepgramClient } from '../meetings/deepgram';
import { ApolloClient } from '../prospects/apollo';
import { OperatorGuard, OperatorTokens } from './operator-auth';
import { OperatorController } from './operator.controller';
import { OperatorService } from './operator.service';

/** The platform operator console's API, a separate realm from workspace sign-in. */
@Module({ imports: [AuthModule, BillingModule], controllers: [OperatorController], providers: [OperatorService, OperatorTokens, OperatorGuard, ApolloClient, HunterClient, DeepgramClient] })
export class OperatorModule {}
