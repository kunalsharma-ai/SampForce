import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AiModule } from './ai/ai.module';
import { AuditModule } from './audit/audit.module';
import { AutomationModule } from './automation/automation.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { FeatureGuard } from './billing/feature.guard';
import { CommercialModule } from './commercial/commercial.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PreferencesModule } from './preferences/preferences.module';
import { ViewsModule } from './views/views.module';
import { CommonModule } from './common/common.module';
import { PasswordConfirmationGuard } from './common/password-confirmation';
import { ChatModule } from './chat/chat.module';
import { SupportModule } from './support/support.module';
import { CrmModule } from './crm/crm.module';
import { CallsModule } from './calls/calls.module';
import { MyOrganizationModule } from './my-organization/my-organization.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { MarketingModule } from './marketing/marketing.module';
import { OriginGuard } from './common/origin.guard';
import { WebsiteEnquiriesModule } from './website-enquiries/website-enquiries.module';
import { OperatorModule } from './operator/operator.module';
import { SpecialDaysModule } from './special-days/special-days.module';
import { MobileModule } from './mobile/mobile.module';
import { MobileRecordsModule } from './mobile/records/mobile-records.module';
import { ProfilePhotosModule } from './profile-photos/profile-photos.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { PortalModule } from './portal/portal.module';
import { IdentityModule } from './identity/identity.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CommandCenterModule } from './command-center/command-center.module';
import { HealthController } from './health/health.controller';
import { RevenueModule } from './revenue/revenue.module';
import { SequencesModule } from './sequences/sequences.module';
import { ExtensionModule } from './extension/extension.module';
import { FinderModule } from './finder/finder.module';
import { GamificationModule } from './gamification/gamification.module';
import { ProspectsModule } from './prospects/prospects.module';
import { IntelligenceModule } from './intelligence/intelligence.module';
import { MailModule } from './mail/mail.module';
import { OwnServersModule } from './own-servers/own-servers.module';
import { TenantsModule } from './tenants/tenants.module';
import { FieldAccessInterceptor } from './workspaces/field-access.interceptor';
import { ApprovalGuard } from './team-approvals/approval.guard';
import { ApprovalInterceptor } from './team-approvals/approval.interceptor';
import { TeamApprovalsModule } from './team-approvals/team-approvals.module';
import { HierarchyGuard } from './workspaces/hierarchy.guard';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { WorkspaceWorkModule } from './workspace-work/workspace-work.module';
import { AvailabilityModule } from './availability/availability.module';
import { AchievementsModule } from './achievements/achievements.module';
import { TaskPlansModule } from './task-plans/task-plans.module';
import { RecognitionModule } from './recognition/recognition.module';
import { WorkerModule } from './worker/worker.module';
import { redactUrl } from './observability/redact';
import { AuditRequiredInterceptor } from './operator/audit-required.interceptor';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        // Credentials never reach the logs, even if a serializer above is widened later.
        redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], censor: '[redacted]' },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: redactUrl(req.url) }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 300) }]),
    CommonModule,
    AuditModule,
    AuthModule,
    TenantsModule,
    WorkspacesModule,
    WorkspaceWorkModule,
    TeamApprovalsModule,
    AvailabilityModule,
    AchievementsModule,
    TaskPlansModule,
    RecognitionModule,
    DashboardModule,
    CommandCenterModule,
    CrmModule,
    CallsModule,
    MyOrganizationModule,
    ChatModule,
    SupportModule,
    AutomationModule,
    AiModule,
    OwnServersModule,
    CommercialModule,
    MarketingModule,
    RevenueModule,
    BillingModule,
    OperatorModule,
    SpecialDaysModule,
    MobileModule,
    MobileRecordsModule,
    ProfilePhotosModule,
    AnnouncementsModule,
    ReportsModule,
    IdentityModule,
    SequencesModule,
    ExtensionModule,
    FinderModule,
    GamificationModule,
    WebsiteEnquiriesModule,
    ProspectsModule,
    IntelligenceModule,
    PortalModule,
    MailModule,
    WorkerModule,
    ApiKeysModule,
    PreferencesModule,
    ViewsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    // After AuthGuard, which sets the workspace: plan features (ADR 0057).
    { provide: APP_GUARD, useClass: FeatureGuard },
    // After FeatureGuard: the caller's workspace must have the route's features and action (ADR 0071).
    { provide: APP_GUARD, useClass: HierarchyGuard },
    // After the workspace checks: an Executive Workspace needs its manager's approval to delete (ADR 0098).
    { provide: APP_GUARD, useClass: ApprovalGuard },
    // Last: a destructive route needs a fresh password confirmation, checked after every right to act on it.
    { provide: APP_GUARD, useClass: PasswordConfirmationGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Console writes must write a platform audit entry (ADR 0074, C3).
    // Deletes are kept in Deleted items, and approved requests run once (ADR 0098).
    { provide: APP_INTERCEPTOR, useClass: ApprovalInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditRequiredInterceptor },
    // Record fields the Console withholds from Manager and Executive Workspaces (R8, ADR 0092).
    { provide: APP_INTERCEPTOR, useClass: FieldAccessInterceptor },
  ],
})
export class AppModule {}
