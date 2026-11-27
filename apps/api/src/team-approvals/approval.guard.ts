import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APPROVAL_HEADER, APPROVAL_REQUIRED, type GuardedApprovalCategory } from '@dealflow/types';
import type { AuthedRequest } from '../common/auth-context';
import { CONFIRMS_PASSWORD, type ConfirmPasswordRule } from '../common/password-confirmation/password-confirmation.decorator';
import { recordOfRoute } from './record-of-route';
import { TeamApprovalsService } from './team-approvals.service';

export type ApprovalRequest = AuthedRequest & { approvalToUse?: string };

/** The API path the client sent, after /api/v1, with its query string. */
export function apiPathOf(req: AuthedRequest): string {
  const url = req.originalUrl ?? req.url;
  return url.startsWith('/api/v1') ? url.slice('/api/v1'.length) || '/' : url;
}

/** Whether this request deletes: a route marked @ConfirmPassword that removes data on this request. */
export function deletesData(reflector: Reflector, ctx: ExecutionContext, req: AuthedRequest): boolean {
  const rule = reflector.getAllAndOverride<ConfirmPasswordRule | undefined>(CONFIRMS_PASSWORD, [ctx.getHandler(), ctx.getClass()]);
  return !!rule && rule.deletes !== false && (!rule.when || rule.when(req));
}

const EDITED = new Set(['Company', 'Contact', 'Lead', 'Opportunity']);

/**
 * Global guard after the workspace checks and before the password check (ADR 0097). An Executive Workspace may not
 * delete (and, when the Super Workspace says so, edit companies, contacts and deals) without its manager's approval:
 * the request must name an approved request for exactly this action in X-Approval-Id. Without one the answer is
 * 403 APPROVAL_REQUIRED, which the screens turn into "Ask your manager". The approval is claimed later, in
 * ApprovalInterceptor, once every check has passed, so a password prompt in between does not use it up.
 */
@Injectable()
export class ApprovalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly approvals: TeamApprovalsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<ApprovalRequest>();
    const auth = req.auth;
    // Machine callers are never Executive Workspaces people, and cannot confirm a password to delete anyway.
    if (!auth || !auth.workspaceNodeId || auth.via === 'api_key' || auth.via === 'extension') return true;
    const method = req.method.toUpperCase();
    const path = apiPathOf(req);
    let category: GuardedApprovalCategory | null = null;
    if (deletesData(this.reflector, ctx, req)) category = 'delete';
    else if (method === 'PATCH' || method === 'PUT') {
      const rr = recordOfRoute(path, req.body);
      if (rr?.model && rr.scope === 'single' && EDITED.has(rr.model)) category = 'record_edit';
    }
    if (!category || !(await this.approvals.requirement(auth, category))) return true;

    const raw = req.headers[APPROVAL_HEADER];
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (id) {
      await this.approvals.assertUsable(auth, id, method, path, req.body);
      req.approvalToUse = id;
      return true;
    }
    const [pendingId, about] = await Promise.all([this.approvals.sameOpen(auth, method, path, req.body), this.approvals.describeAction(auth, path, req.body)]);
    throw new ForbiddenException({
      code: APPROVAL_REQUIRED,
      message: category === 'delete' ? 'Your manager needs to approve this delete first.' : 'Your manager needs to approve this change first.',
      details: [
        { path: 'category', message: category },
        ...(about.recordTypeLabel ? [{ path: 'recordTypeLabel', message: about.recordTypeLabel }] : []),
        ...(about.recordName ? [{ path: 'recordName', message: about.recordName }] : []),
        ...(about.recordCount !== null ? [{ path: 'recordCount', message: String(about.recordCount) }] : []),
        ...(pendingId ? [{ path: 'pendingId', message: pendingId }] : []),
      ],
    });
  }
}
