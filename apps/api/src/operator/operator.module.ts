import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { HunterClient } from '../finder/hunter';
import { DeepgramClient } from '../meetings/deepgram';
import { ApolloClient } from '../prospects/apollo';
import { ConnectionTests } from './connection-tests';
import { OperatorAdminController } from './operator-admin.controller';
import { OperatorAdminService } from './operator-admin.service';
import { OperatorGuard, OperatorTokens } from './operator-auth';
import { OperatorSecurityController } from './operator-security.controller';
import { OperatorSecurityService } from './operator-security.service';
import { OperatorSessions } from './operator-sessions';
import { OperatorController } from './operator.controller';
import { ConsoleService } from './console.service';
import { ConsoleShellService } from './console-shell.service';
import { OperatorService } from './operator.service';

/** The platform operator console's API, a separate realm from workspace sign-in. */
@Module({ imports: [AuthModule, BillingModule], controllers: [OperatorController, OperatorAdminController, OperatorSecurityController], providers: [OperatorService, OperatorAdminService, OperatorSecurityService, OperatorSessions, ConsoleService, ConsoleShellService, OperatorTokens, OperatorGuard, ApolloClient, HunterClient, DeepgramClient, ConnectionTests], exports: [OperatorTokens, OperatorGuard, OperatorSessions] })
export class OperatorModule {}
