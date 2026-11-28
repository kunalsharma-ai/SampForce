import { type CallHandler, type ExecutionContext, ForbiddenException, Injectable, Logger, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { newRecycleScope, type RecycleScope, runInRecycleScope } from '@dealflow/database';
import { catchError, from, mergeMap, Observable, throwError } from 'rxjs';
import { requestMeta } from '../common/auth-context';
import { type ApprovalRequest, apiPathOf, deletesData } from './approval.guard';
import { RecycleBinService } from './recycle-bin.service';
import { TeamApprovalsService } from './team-approvals.service';

/**
 * Runs every delete request (ADR 0098) so that what it removes is kept in Deleted items, and carries out an
 * approved request exactly once: the approval is claimed when the handler starts, completed when it succeeds (with
 * the Deleted items batch it made) and released again when it fails, so the person can try again.
 */
@Injectable()
export class ApprovalInterceptor implements NestInterceptor {
  private readonly log = new Logger(ApprovalInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly approvals: TeamApprovalsService,
    private readonly bin: RecycleBinService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<ApprovalRequest>();
    const auth = req.auth;
    if (!auth) return next.handle();
    const approvalId = req.approvalToUse ?? null;
    const scope: RecycleScope | null = deletesData(this.reflector, ctx, req) ? newRecycleScope() : null;
    if (!scope && !approvalId) return next.handle();

    const method = req.method.toUpperCase();
    const path = apiPathOf(req);
    const body: unknown = req.body;
    const meta = requestMeta(req);
    const finish = async (ok: boolean) => {
      let batchId: string | null = null;
      if (scope?.entries.length) {
        try {
          batchId = await this.bin.keep(auth, scope, method, path, body, approvalId);
        } catch (err) {
          // The delete itself went through; failing to keep a copy must not turn it into an error.
          this.log.error({ err: err instanceof Error ? err.message : String(err), path }, 'could not keep deleted items');
        }
      }
      if (!approvalId) return;
      if (ok || scope?.entries.length) await this.approvals.complete(auth, approvalId, batchId, meta);
      else await this.approvals.release(auth, approvalId);
    };

    const start = approvalId
      ? from(this.approvals.claim(auth, approvalId)).pipe(
          mergeMap((claimed) => (claimed ? [true] : throwError(() => new ForbiddenException({ code: 'APPROVAL_NOT_VALID', message: 'This approval is already being used.' })))),
        )
      : from([true]);
    return start.pipe(
      mergeMap(() => (scope ? inScope(scope, next) : next.handle()).pipe(
        mergeMap(async (value) => {
          await finish(true);
          return value;
        }),
        catchError((err: unknown) => from(finish(false)).pipe(mergeMap(() => throwError(() => err)))),
      )),
    );
  }
}

/** The handler, called and subscribed inside the recycle scope so every query it makes sees the scope. */
function inScope(scope: RecycleScope, next: CallHandler): Observable<unknown> {
  return new Observable((subscriber) => runInRecycleScope(scope, () => next.handle().subscribe(subscriber)));
}
