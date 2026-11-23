import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CookieOptions, Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { BUILT_IN_ROLE_DEFS, defaultRoleKey, expandPermissions, isBuiltInRole, type OperatorPermission as Permission } from '@dealflow/types';
import { auditContext } from '../common/audit-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { OPERATOR_SESSION_SECONDS, OperatorSessions } from './operator-sessions';

/**
 * The operator realm is separate from workspace sign-in: its own accounts, signing key, cookie and
 * guard. A workspace session never authorises an operator route, and an operator session is never
 * accepted by workspace routes (different key, issuer and audience).
 */
export const OPERATOR_COOKIE = 'df_op';
export const OPERATOR_COOKIE_PATH = '/api/v1/operator';
const ISSUER = 'dealflow-operator';
export { OPERATOR_REMEMBER_SECONDS, OPERATOR_SESSION_SECONDS } from './operator-sessions';
const CHALLENGE_AUDIENCE = 'dealflow-operator-mfa';

export interface OperatorContext {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SUPPORT';
  /** The OperatorSession of this request (absent when the context is built outside a request, e.g. at sign-in). */
  sessionId?: string;
  /** The policy asks for two-step verification and the operator has not turned it on: only their own pages open. */
  mfaSetupRequired?: boolean;
  /** The Console role (ADR 0074): a built-in key or a custom role id, its name, and what it allows. */
  consoleRole: string;
  roleName: string;
  permissions: Permission[];
}

type OperatorRequest = Request & { operator?: OperatorContext };

const disabled = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });

@Injectable()
export class OperatorTokens {
  private readonly key: Uint8Array | null;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.key = env.OPERATOR_JWT_SECRET ? new TextEncoder().encode(env.OPERATOR_JWT_SECRET) : null;
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  /** A session cookie naming the operator and their OperatorSession row (`sid`), which the guard checks on every request. */
  sign(operatorId: string, sid: string, seconds = OPERATOR_SESSION_SECONDS): Promise<string> {
    if (!this.key) throw disabled();
    return new SignJWT({ sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(operatorId).setIssuer(ISSUER).setAudience(ISSUER).setIssuedAt().setExpirationTime(`${seconds}s`).sign(this.key);
  }

  async verify(token: string): Promise<{ sub: string; sid: string } | null> {
    if (!this.key) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: ISSUER, algorithms: ['HS256'] });
      return typeof payload.sub === 'string' && typeof payload.sid === 'string' ? { sub: payload.sub, sid: payload.sid } : null;
    } catch {
      return null;
    }
  }

  /** The five-minute ticket between the password and the second step; a different audience, so it is never a session. */
  signChallenge(operatorId: string): Promise<string> {
    if (!this.key) throw disabled();
    return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(operatorId).setIssuer(ISSUER).setAudience(CHALLENGE_AUDIENCE).setIssuedAt().setExpirationTime('300s').sign(this.key);
  }

  async verifyChallenge(token: string): Promise<string | null> {
    if (!this.key) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: CHALLENGE_AUDIENCE, algorithms: ['HS256'] });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  cookie(res: Response, token: string | null, seconds = OPERATOR_SESSION_SECONDS): void {
    const opts: CookieOptions = { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'strict', path: OPERATOR_COOKIE_PATH };
    if (token) res.cookie(OPERATOR_COOKIE, token, { ...opts, maxAge: seconds * 1000 });
    else res.clearCookie(OPERATOR_COOKIE, opts);
  }
}

const OPERATOR_PERMISSION = 'dealflow:operatorPermission';
const OPERATOR_ANY = 'dealflow:operatorAny';
/** The permission a route needs (ADR 0074); with several, the operator needs all of them. Every operator route has one. */
export const OperatorPermission = (...perms: Permission[]) => SetMetadata(OPERATOR_PERMISSION, perms);
/** A route for any signed-in operator, whatever their role: their own profile, preferences, search and sign-out. */
export const OperatorAny = () => SetMetadata(OPERATOR_ANY, true);
const OPERATOR_PUBLIC = 'dealflow:operatorPublic';
/** The login route: reachable without an operator session (but still 404 when the console is disabled). */
export const OperatorPublic = () => SetMetadata(OPERATOR_PUBLIC, true);
const OPERATOR_NO_AUDIT = 'dealflow:operatorNoAudit';
/**
 * A Console write that is not a change to the platform and so writes no platform audit entry (marking a
 * notification read, saving one's own preferences). Every other write must record itself (AuditRequiredInterceptor).
 */
export const OperatorNoAudit = () => SetMetadata(OPERATOR_NO_AUDIT, true);
export const OPERATOR_ROUTE_METADATA = { permission: OPERATOR_PERMISSION, any: OPERATOR_ANY, public: OPERATOR_PUBLIC, noAudit: OPERATOR_NO_AUDIT } as const;

type OperatorRow = { id: string; email: string; name: string; role: 'ADMIN' | 'SUPPORT'; consoleRole: string | null };
type RoleReader = Pick<PrismaService, 'operatorConsoleRole'>;

/** An operator with their role resolved: built-in roles from code, custom ones from the database. */
export async function operatorContext(prisma: RoleReader, op: OperatorRow): Promise<OperatorContext> {
  const key = op.consoleRole ?? defaultRoleKey(op.role);
  const base = { id: op.id, email: op.email, name: op.name, role: op.role, consoleRole: key };
  if (isBuiltInRole(key)) return { ...base, roleName: BUILT_IN_ROLE_DEFS[key].name, permissions: BUILT_IN_ROLE_DEFS[key].permissions };
  const custom = await prisma.operatorConsoleRole.findUnique({ where: { id: key } });
  // A role that no longer exists grants nothing (roles in use cannot be deleted, so this is a safety net).
  return { ...base, roleName: custom?.name ?? 'No role', permissions: custom ? expandPermissions(custom.permissions) : [] };
}

export const FORBIDDEN_FOR_ROLE = { code: 'FORBIDDEN', message: 'Your operator role does not allow this action.' };

@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: OperatorTokens,
    private readonly prisma: PrismaService,
    private readonly sessions: OperatorSessions,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.tokens.enabled) throw disabled();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(OPERATOR_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<OperatorRequest>();
    const raw = (req.cookies as Record<string, string> | undefined)?.[OPERATOR_COOKIE];
    const claims = raw ? await this.tokens.verify(raw) : null;
    // Operators are platform-level rows with no tenant, so these lookups need no tenant context.
    const op = claims ? await this.prisma.platformOperator.findUnique({ where: { id: claims.sub } }) : null;
    const session = op && op.status === 'ACTIVE' ? await this.sessions.check(claims!.sid, op.id) : null;
    if (!op || !session) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to the operator console.' });
    req.operator = { ...(await operatorContext(this.prisma, op)), sessionId: session.id, mfaSetupRequired: session.mfaSetupRequired };
    const audit = auditContext();
    if (audit) audit.sessionId = session.id;
    if (this.reflector.getAllAndOverride<boolean>(OPERATOR_ANY, targets)) return true;
    if (req.operator.mfaSetupRequired) throw new ForbiddenException({ code: 'MFA_SETUP_REQUIRED', message: 'Turn on two-step verification to use the Console.' });
    const needed = this.reflector.getAllAndOverride<Permission[]>(OPERATOR_PERMISSION, targets);
    // A route without a permission is closed: the route test makes sure none ships that way.
    if (!needed?.length || !needed.every((p) => req.operator!.permissions.includes(p))) throw new ForbiddenException(FORBIDDEN_FOR_ROLE);
    return true;
  }
}

export const Operator = createParamDecorator((_: unknown, ctx: ExecutionContext): OperatorContext => {
  const op = ctx.switchToHttp().getRequest<OperatorRequest>().operator;
  if (!op) throw new Error('Operator context missing: route is not protected by OperatorGuard');
  return op;
});
