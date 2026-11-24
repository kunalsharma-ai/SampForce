import { GeoModule } from '../geo/geo.module';
import { ConsoleHealthController } from './console-health.controller';
import { ConsoleOverviewController } from './console-overview.controller';
import { ConsoleOverviewService } from './console-overview.service';
import { ConsoleHealthService } from './console-health.service';
import { ConsoleClientsListController } from './console-clients-list.controller';
import { ConsoleClientsListService } from './console-clients-list.service';
import { ConsoleClientsProfileController } from './console-clients-profile.controller';
import { ConsoleClientsProfileService } from './console-clients-profile.service';
import { ConsoleNotificationsController } from './console-notifications.controller';
import { ConsoleNotificationsModule } from './console-notifications.module';
import { ConsoleAuditController } from './console-audit.controller';
import { ConsoleAuditService } from './console-audit.service';
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
@Module({ imports: [AuthModule, BillingModule, ConsoleNotificationsModule, GeoModule], controllers: [ConsoleClientsListController, OperatorController, ConsoleClientsProfileController, OperatorAdminController, OperatorSecurityController, ConsoleAuditController, ConsoleNotificationsController, ConsoleHealthController, ConsoleOverviewController], providers: [ConsoleHealthService, ConsoleOverviewService, OperatorService, ConsoleClientsListService, ConsoleClientsProfileService, ConsoleAuditService, OperatorAdminService, OperatorSecurityService, OperatorSessions, ConsoleService, ConsoleShellService, OperatorTokens, OperatorGuard, ApolloClient, HunterClient, DeepgramClient, ConnectionTests], exports: [OperatorTokens, OperatorGuard, OperatorSessions, ConsoleHealthService, ConsoleOverviewService] })
export class OperatorModule {}
