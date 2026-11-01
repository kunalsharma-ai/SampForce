import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EXTENSION_TOKEN_PREFIX, API_KEY_PREFIX } from '@dealflow/types';
import type { Request } from 'express';
import { API_ENV, type ApiEnv } from './env';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const CROSS_SITE = 'dealflow:crossSite';

/**
 * Marks public, cookie-less endpoints that other websites may call (the visitor tracking script). They read no
 * session, so cross-site requests cannot act as a signed-in user; they check their own allowed origins instead.
 */
export const CrossSite = () => SetMetadata(CROSS_SITE, true);

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests that carry an
 * Origin header must come from an allow-listed web origin. Combined with SameSite=Lax cookies.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    private readonly reflector: Reflector,
  ) {
    this.allowed = new Set(env.WEB_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean));
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(CROSS_SITE, [ctx.getHandler(), ctx.getClass()])) return true;
    // The browser extension sends its own token in a header and never the cookie (AuthGuard ignores the
    // cookie when that header is present), so a request from its chrome-extension:// origin is not CSRF.
    if (req.get('authorization')?.startsWith(`Bearer ${EXTENSION_TOKEN_PREFIX}`)) return true;
    // Likewise an API key (Zapier, scripts): sent in a header, never with the cookie.
    if (req.get('authorization')?.startsWith(`Bearer ${API_KEY_PREFIX}`)) return true;
    const origin = req.get('origin');
    if (!origin || this.allowed.has(origin)) return true;
    throw new ForbiddenException({ code: 'BAD_ORIGIN', message: 'Request origin is not allowed.' });
  }
}
