import { CompanyClosureService } from '../tenants/company-closure.service';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { HunterClient } from '../finder/hunter';
import { DeepgramClient } from '../meetings/deepgram';
import { ApolloClient } from '../prospects/apollo';
import { ConnectionTests } from './connection-tests';
import { OperatorGuard, OperatorTokens } from './operator-auth';
import { OperatorController } from './operator.controller';
import { ConsoleService } from './console.service';
import { OperatorService } from './operator.service';
import { WorkspaceRulesController } from './workspace-rules.controller';
import { WorkspaceRulesService } from './workspace-rules.service';

/** The platform operator console's API, a separate realm from workspace sign-in. */
@Module({ imports: [AuthModule, BillingModule], controllers: [OperatorController, WorkspaceRulesController], providers: [CompanyClosureService, OperatorService, WorkspaceRulesService, ConsoleService, OperatorTokens, OperatorGuard, ApolloClient, HunterClient, DeepgramClient, ConnectionTests], exports: [OperatorTokens, OperatorGuard] })
export class OperatorModule {}
