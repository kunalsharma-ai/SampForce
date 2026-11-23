import { type CallHandler, type ExecutionContext, Injectable, InternalServerErrorException, Logger, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, tap } from 'rxjs';
import { auditContext } from '../common/audit-context';
import { OPERATOR_ROUTE_METADATA } from './operator-auth';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Every Console write is audited (ADR 0074, C3). After a signed-in operator's write succeeds, this checks that it
 * wrote at least one platform audit entry. Routes that change nothing on the platform say so with @OperatorNoAudit().
 * Under test a missing entry fails the request, so a new route cannot ship without its entry; in production it is
 * logged instead, because the change has already been made.
 */
@Injectable()
export class AuditRequiredInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditRequired');
  private readonly strict = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<{ method: string; operator?: unknown; route?: { path?: string } }>();
    if (!req.operator || READS.has(req.method)) return next.handle();
    if (this.reflector.getAllAndOverride<boolean>(OPERATOR_ROUTE_METADATA.noAudit, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    return next.handle().pipe(
      tap(() => {
        const audit = auditContext();
        if (!audit || audit.platformWrites > 0) return;
        const message = `${req.method} ${req.route?.path ?? '?'} changed the platform without a platform audit entry.`;
        if (this.strict) throw new InternalServerErrorException({ code: 'UNAUDITED_WRITE', message });
        this.logger.warn(message);
      }),
    );
  }
}
