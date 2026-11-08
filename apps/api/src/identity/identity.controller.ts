import { Body, Controller, Delete, Get, HttpCode, Inject, Logger, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  mfaPolicySchema,
  type ScimTokenView,
  scimTokenCreateSchema,
  type SecuritySettings,
  type SsoConnectionInput,
  ssoConnectionSchema,
  type SsoConnectionView,
} from '@dealflow/types';
import { setAuthCookies } from '../auth/cookies';
import { Auth, type AuthContext, type AuthedRequest, Meta, Public, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { authEvents } from '../observability/metrics';
import { SecurityService } from './security.service';
import { SSO_STATE_TTL_MS, SsoFailure, SsoService } from './sso.service';

const SSO_COOKIE = 'df_sso';
const SSO_COOKIE_PATH = '/api/v1/auth/sso';

/** Single sign-on: browser redirects to and from the workspace's identity provider. */
@Controller('auth/sso')
export class SsoController {
  private readonly logger = new Logger(SsoController.name);

  constructor(
    private readonly sso: SsoService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private web(path: string): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}${path}`;
  }

  @Public()
  @Throttle({ default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } })
  @Get('start')
  async start(@Query('workspace') workspace: string | undefined, @Query('email') email: string | undefined, @Res() res: Response): Promise<void> {
    try {
      const { url, cookie } = await this.sso.start(String(workspace ?? '').slice(0, 63), email ? String(email).slice(0, 254) : undefined);
      res.cookie(SSO_COOKIE, cookie, { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: SSO_COOKIE_PATH, maxAge: SSO_STATE_TTL_MS });
      res.redirect(302, url);
    } catch (e) {
      if (!(e instanceof SsoFailure)) throw e;
      res.redirect(302, this.web(`/login/sso?sso_error=${e.code}`));
    }
  }

  @Public()
  @Get('callback')
  async callback(@Query() query: Record<string, string>, @Req() req: AuthedRequest, @Meta() meta: RequestMeta, @Res() res: Response): Promise<void> {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[SSO_COOKIE];
    res.clearCookie(SSO_COOKIE, { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: SSO_COOKIE_PATH });
    try {
      const tokens = await this.sso.callback({ code: query.code, state: query.state, error: query.error }, cookie, meta);
      setAuthCookies(res, this.env, tokens);
      authEvents.inc({ event: 'sso_success' });
      res.redirect(302, this.web('/app'));
    } catch (e) {
      if (!(e instanceof SsoFailure)) throw e;
      authEvents.inc({ event: 'sso_failure' });
      this.logger.warn({ requestId: meta.requestId, reason: e.code, detail: e.message }, 'Single sign-on refused');
      res.redirect(302, this.web(`/login/sso?sso_error=${e.code}`));
    }
  }
}

/** Workspace security settings (admins). */
@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('settings')
  @RequirePermissions('tenant:manage')
  settings(@Auth() auth: AuthContext): Promise<SecuritySettings> {
    return this.security.settings(auth);
  }

  @Put('mfa-policy')
  @RequirePermissions('tenant:manage')
  async mfaPolicy(@Auth() auth: AuthContext, @Body(new ZodPipe(mfaPolicySchema)) body: { requireMfa: boolean }, @Meta() meta: RequestMeta): Promise<{ requireMfa: boolean }> {
    await this.security.setMfaPolicy(auth, body.requireMfa, meta);
    return body;
  }

  @Put('sso')
  @RequireFeature('sso_scim')
  @RequirePermissions('tenant:manage')
  saveSso(@Auth() auth: AuthContext, @Body(new ZodPipe(ssoConnectionSchema)) body: SsoConnectionInput, @Meta() meta: RequestMeta): Promise<SsoConnectionView> {
    return this.security.saveSso(auth, body, meta);
  }

  @Delete('sso')
  @HttpCode(204)
  @RequirePermissions('tenant:manage')
  deleteSso(@Auth() auth: AuthContext, @Meta() meta: RequestMeta): Promise<void> {
    return this.security.deleteSso(auth, meta);
  }

  @Post('scim-tokens')
  @RequireFeature('sso_scim')
  @RequirePermissions('tenant:manage')
  createScimToken(@Auth() auth: AuthContext, @Body(new ZodPipe(scimTokenCreateSchema)) body: { name: string }, @Meta() meta: RequestMeta): Promise<ScimTokenView & { token: string }> {
    return this.security.createScimToken(auth, body.name, meta);
  }

  @Delete('scim-tokens/:id')
  @HttpCode(204)
  @RequirePermissions('tenant:manage')
  revokeScimToken(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta): Promise<void> {
    return this.security.revokeScimToken(auth, id, meta);
  }
}
