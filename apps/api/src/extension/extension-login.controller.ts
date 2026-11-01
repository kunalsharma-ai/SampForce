import { Body, Controller, ForbiddenException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { extensionLoginMfaSchema, extensionLoginSchema, type ExtensionTokenCreated } from '@dealflow/types';
import type { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { Meta, Public, type RequestMeta } from '../common/auth-context';
import type { Request } from 'express';
import { API_ENV, type ApiEnv } from '../common/env';
import { CrossSite } from '../common/origin.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ExtensionService } from './extension.service';

const LIMIT = { default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };
type SignedIn = ExtensionTokenCreated;
type Challenge = { mfaRequired: true; challenge: string };

/** Browser extension origins. Ordinary websites are refused, so they cannot drive sign-in attempts or lockouts. */
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[a-z0-9-]+$/i;

/**
 * Signing in from the extension with a DealFlow email and password. It goes through the same password check,
 * lockout and second factor as the web app, but sets no cookie: the answer is an extension connection token,
 * which only reaches routes marked @ExtensionAccess. Workspaces that enforce single sign-on still need a
 * connection code made in the web app after an SSO sign-in.
 */
@Controller('extension/login')
@Public()
@CrossSite()
export class ExtensionLoginController {
  constructor(
    private readonly auth: AuthService,
    private readonly extension: ExtensionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * Cross-site is allowed only for the extension itself (and the web app). A request without an Origin header is
   * not from a web page, so it is no more than a direct API call and the usual throttling and lockout apply.
   */
  private checkOrigin(req: Request) {
    const origin = req.get('origin');
    if (!origin || EXTENSION_ORIGIN.test(origin) || this.env.WEB_ORIGINS.split(',').map((o) => o.trim()).includes(origin)) return;
    throw new ForbiddenException({ code: 'BAD_ORIGIN', message: 'Request origin is not allowed.' });
  }

  private async connect(r: { userId: string; tenantId: string; scope: { authMethod: 'password' | 'mfa' | 'sso'; ssoTenantId?: string | null } }, name: string, meta: RequestMeta) {
    return this.extension.createTokenFor(r.userId, r.tenantId, r.scope, name, meta, 'password');
  }

  private ssoHint(e: unknown): never {
    if (e instanceof ForbiddenException && (e.getResponse() as { code?: string }).code === 'SSO_REQUIRED') {
      throw new ForbiddenException({ code: 'SSO_REQUIRED', message: 'Your workspace requires single sign-on. Sign in to DealFlow with SSO, make a connection code under Settings, then paste it here.' });
    }
    throw e;
  }

  @Post()
  @HttpCode(200)
  @Throttle(LIMIT)
  async login(@Body(new ZodPipe(extensionLoginSchema)) body: z.infer<typeof extensionLoginSchema>, @Meta() meta: RequestMeta, @Req() req: Request): Promise<SignedIn | Challenge> {
    this.checkOrigin(req);
    const r = await this.auth.extensionSignIn({ email: body.email, password: body.password }, meta).catch((e) => this.ssoHint(e));
    if ('mfaRequired' in r) return r;
    return this.connect(r, body.name, meta);
  }

  @Post('mfa')
  @HttpCode(200)
  @Throttle(LIMIT)
  async mfa(@Body(new ZodPipe(extensionLoginMfaSchema)) body: z.infer<typeof extensionLoginMfaSchema>, @Meta() meta: RequestMeta, @Req() req: Request): Promise<SignedIn> {
    this.checkOrigin(req);
    const r = await this.auth.extensionVerifyMfa(body.challenge, body.code, meta).catch((e) => this.ssoHint(e));
    return this.connect(r, body.name, meta);
  }
}
