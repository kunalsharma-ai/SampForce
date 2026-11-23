import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PASSWORD_CONFIRMATION_HEADER, PASSWORD_CONFIRMATION_REQUIRED } from '@dealflow/types';
import { AuditService } from '../../audit/audit.service';
import { type AuthedRequest, requestMeta } from '../auth-context';
import { PrismaService } from '../prisma.service';
import { CONFIRMS_PASSWORD, type ConfirmPasswordRule } from './password-confirmation.decorator';
import { PasswordConfirmationService } from './password-confirmation.service';

/**
 * Global guard, last in line (after the role, plan and workspace checks, so a person without the right to delete is
 * told that first): a route marked @ConfirmPassword runs only with a fresh password-confirmation pass in the
 * X-Password-Confirmation header. Without one the answer is 403 PASSWORD_CONFIRMATION_REQUIRED and the interface asks
 * for the password; a pass that is wrong, spent, expired or from another session gets the same answer and is logged
 * as a refused attempt. Machine callers (API keys, directory sync) cannot type a password, so they never reach a
 * marked route.
 */
@Injectable()
export class PasswordConfirmationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly confirmations: PasswordConfirmationService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const rule = this.reflector.getAllAndOverride<ConfirmPasswordRule | undefined>(CONFIRMS_PASSWORD, [ctx.getHandler(), ctx.getClass()]);
    if (!rule) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (rule.when && !rule.when(req)) return true;

    const principal = this.confirmations.principalOf(req);
    if (!principal || req.auth?.via === 'api_key' || req.auth?.via === 'extension') throw required('Enter your password to delete this.');
    const raw = req.headers[PASSWORD_CONFIRMATION_HEADER];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) throw required('Enter your password to delete this.');
    if (await this.confirmations.spend(token, principal)) return true;

    if (req.auth) {
      const auth = req.auth;
      await this.prisma.run({ tenantId: auth.tenantId, userId: auth.userId }, (tx) =>
        this.audit.record(tx, {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          action: 'security.delete_refused',
          outcome: 'REFUSED',
          metadata: { reason: 'Password confirmation missing or expired', method: req.method, path: req.path },
          meta: requestMeta(req),
        }),
      );
    }
    throw required('Your password check has expired. Enter your password again.');
  }
}

function required(message: string): ForbiddenException {
  return new ForbiddenException({ code: PASSWORD_CONFIRMATION_REQUIRED, message });
}
