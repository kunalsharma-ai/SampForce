import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AuditModule } from './audit/audit.module';
import { AutomationModule } from './automation/automation.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { CrmModule } from './crm/crm.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { OriginGuard } from './common/origin.guard';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthController } from './health/health.controller';
import { TenantsModule } from './tenants/tenants.module';

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
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    CommonModule,
    AuditModule,
    AuthModule,
    TenantsModule,
    DashboardModule,
    CrmModule,
    AutomationModule,
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
