import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AiModule } from './ai/ai.module';
import { AuditModule } from './audit/audit.module';
import { AutomationModule } from './automation/automation.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CommercialModule } from './commercial/commercial.module';
import { CommonModule } from './common/common.module';
import { CrmModule } from './crm/crm.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { MarketingModule } from './marketing/marketing.module';
import { OriginGuard } from './common/origin.guard';
import { OperatorModule } from './operator/operator.module';
import { IdentityModule } from './identity/identity.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthController } from './health/health.controller';
import { RevenueModule } from './revenue/revenue.module';
import { SequencesModule } from './sequences/sequences.module';
import { TenantsModule } from './tenants/tenants.module';
import { WorkerModule } from './worker/worker.module';
import { redactUrl } from './observability/redact';

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
    DashboardModule,
    CrmModule,
    AutomationModule,
    AiModule,
    CommercialModule,
    MarketingModule,
    RevenueModule,
    BillingModule,
    OperatorModule,
    ReportsModule,
    IdentityModule,
    SequencesModule,
    WorkerModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
