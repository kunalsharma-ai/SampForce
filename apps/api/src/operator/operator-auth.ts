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
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';

/**
 * The operator realm is separate from workspace sign-in: its own accounts, signing key, cookie and
 * guard. A workspace session never authorises an operator route, and an operator session is never
 * accepted by workspace routes (different key, issuer and audience).
 */
export const OPERATOR_COOKIE = 'df_op';
export const OPERATOR_COOKIE_PATH = '/api/v1/operator';
const ISSUER = 'dealflow-operator';
/** Operator sessions are short; there is no refresh token. */
export const OPERATOR_SESSION_SECONDS = 8 * 60 * 60;

export interface OperatorContext {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SUPPORT';
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

  sign(operatorId: string): Promise<string> {
    if (!this.key) throw disabled();
    return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(operatorId).setIssuer(ISSUER).setAudience(ISSUER).setIssuedAt().setExpirationTime(`${OPERATOR_SESSION_SECONDS}s`).sign(this.key);
  }

  async verify(token: string): Promise<string | null> {
    if (!this.key) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: ISSUER, algorithms: ['HS256'] });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  cookie(res: Response, token: string | null): void {
    const opts: CookieOptions = { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'strict', path: OPERATOR_COOKIE_PATH };
    if (token) res.cookie(OPERATOR_COOKIE, token, { ...opts, maxAge: OPERATOR_SESSION_SECONDS * 1000 });
    else res.clearCookie(OPERATOR_COOKIE, opts);
  }
}

const OPERATOR_ROLES = 'dealflow:operatorRoles';
/** Restricts an operator route to the listed operator roles (default: any active operator). */
export const OperatorRoles = (...roles: OperatorContext['role'][]) => SetMetadata(OPERATOR_ROLES, roles);
const OPERATOR_PUBLIC = 'dealflow:operatorPublic';
/** The login route: reachable without an operator session (but still 404 when the console is disabled). */
export const OperatorPublic = () => SetMetadata(OPERATOR_PUBLIC, true);

@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: OperatorTokens,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.tokens.enabled) throw disabled();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(OPERATOR_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<OperatorRequest>();
    const raw = (req.cookies as Record<string, string> | undefined)?.[OPERATOR_COOKIE];
    const id = raw ? await this.tokens.verify(raw) : null;
    // Operators are platform-level rows with no tenant, so this lookup needs no tenant context.
    const op = id ? await this.prisma.platformOperator.findUnique({ where: { id } }) : null;
    if (!op || op.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to the operator console.' });
    req.operator = { id: op.id, email: op.email, name: op.name, role: op.role };
    const roles = this.reflector.getAllAndOverride<OperatorContext['role'][]>(OPERATOR_ROLES, targets);
    if (roles?.length && !roles.includes(op.role)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your operator role does not allow this action.' });
    return true;
  }
}

export const Operator = createParamDecorator((_: unknown, ctx: ExecutionContext): OperatorContext => {
  const op = ctx.switchToHttp().getRequest<OperatorRequest>().operator;
  if (!op) throw new Error('Operator context missing: route is not protected by OperatorGuard');
  return op;
});
