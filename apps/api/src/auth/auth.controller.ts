import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  type AcceptInvitationInput,
  acceptInvitationSchema,
  type InvitationPreview,
  type LoginInput,
  type LoginResponse,
  loginSchema,
  type MeResponse,
  type MfaDisableInput,
  mfaDisableSchema,
  type MfaEnableInput,
  type MfaEnableResponse,
  mfaEnableSchema,
  mfaRegenerateSchema,
  type MfaSetupInput,
  type MfaSetupResponse,
  mfaSetupSchema,
  type MfaStatus,
  type MfaVerifyInput,
  mfaVerifySchema,
  type PasswordResetInput,
  passwordResetSchema,
  type PasswordResetRequestInput,
  passwordResetRequestSchema,
  type SessionSummary,
  type RegisterInput,
  registerSchema,
  type SwitchTenantInput,
  switchTenantSchema,
} from '@dealflow/types';
import { AllowRestricted, Auth, type AuthContext, type AuthedRequest, Meta, Public, type RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { clearAuthCookies, REFRESH_COOKIE, setAccessCookie, setAuthCookies } from './cookies';

const AUTH_LIMIT = { default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('register')
  async register(
    @Body(new ZodPipe(registerSchema)) body: RegisterInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ tenantId: string }> {
    const tokens = await this.auth.register(body, meta);
    setAuthCookies(res, this.env, tokens);
    return { tenantId: tokens.tenantId };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(body, meta);
    if ('mfaRequired' in result) return result;
    setAuthCookies(res, this.env, result);
    return { tenantId: result.tenantId };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('mfa/verify')
  async verifyMfa(
    @Body(new ZodPipe(mfaVerifySchema)) body: MfaVerifyInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const tokens = await this.auth.verifyMfa(body.challenge, body.code, meta);
    setAuthCookies(res, this.env, tokens);
    return { tenantId: tokens.tenantId };
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() req: AuthedRequest,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ tenantId: string }> {
    try {
      const tokens = await this.auth.refresh(this.refreshCookie(req), meta);
      setAuthCookies(res, this.env, tokens);
      return { tenantId: tokens.tenantId };
    } catch (err) {
      clearAuthCookies(res, this.env);
      throw err;
    }
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: AuthedRequest, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.refreshCookie(req), req.auth, meta);
    clearAuthCookies(res, this.env);
  }

  /** Emails a reset link if the address has an account. Always 202, so it does not reveal who has one. */
  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(202)
  @Post('password-reset/request')
  async requestPasswordReset(@Body(new ZodPipe(passwordResetRequestSchema)) body: PasswordResetRequestInput, @Meta() meta: RequestMeta): Promise<{ ok: true }> {
    await this.auth.requestPasswordReset(body.email, meta);
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(204)
  @Post('password-reset')
  async resetPassword(@Body(new ZodPipe(passwordResetSchema)) body: PasswordResetInput, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.resetPassword(body.token, body.password, meta);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Get('invitations/:token')
  previewInvitation(@Param('token') token: string): Promise<InvitationPreview> {
    return this.auth.previewInvitation(token.slice(0, 200));
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('invitations/accept')
  async acceptInvitation(
    @Body(new ZodPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ tenantId: string }> {
    const tokens = await this.auth.acceptInvitation(body, meta);
    setAuthCookies(res, this.env, tokens);
    return { tenantId: tokens.tenantId };
  }

  @AllowRestricted()
  @Get('me')
  me(@Auth() auth: AuthContext): Promise<MeResponse> {
    return this.auth.me(auth);
  }

  @AllowRestricted()
  @HttpCode(200)
  @Post('switch-tenant')
  async switchTenant(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(switchTenantSchema)) body: SwitchTenantInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ tenantId: string }> {
    const token = await this.auth.switchTenant(auth, body.tenantId, meta);
    setAccessCookie(res, this.env, token);
    return { tenantId: body.tenantId };
  }

  // ───── Two-step verification (the caller's own account) ─────

  @AllowRestricted()
  @Get('mfa')
  mfaStatus(@Auth() auth: AuthContext): Promise<MfaStatus> {
    return this.mfa.status(auth.userId);
  }

  @AllowRestricted()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('mfa/setup')
  mfaSetup(@Auth() auth: AuthContext, @Body(new ZodPipe(mfaSetupSchema)) body: MfaSetupInput): Promise<MfaSetupResponse> {
    return this.mfa.setup(auth.userId, body.password);
  }

  /** Turns the second factor on, signs out every other device and upgrades this session. */
  @AllowRestricted()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('mfa/enable')
  async mfaEnable(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(mfaEnableSchema)) body: MfaEnableInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MfaEnableResponse> {
    const result = await this.mfa.enable(auth.userId, body.code);
    setAuthCookies(res, this.env, await this.auth.upgradeAfterMfa(auth, meta));
    await this.auth.recordSecurityEvent(auth, 'auth.mfa_enabled', meta);
    return result;
  }

  @AllowRestricted()
  @Throttle(AUTH_LIMIT)
  @HttpCode(204)
  @Post('mfa/disable')
  async mfaDisable(@Auth() auth: AuthContext, @Body(new ZodPipe(mfaDisableSchema)) body: MfaDisableInput, @Meta() meta: RequestMeta): Promise<void> {
    await this.mfa.disable(auth.userId, body.password, body.code);
    await this.auth.recordSecurityEvent(auth, 'auth.mfa_disabled', meta);
  }

  @AllowRestricted()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('mfa/recovery-codes')
  async mfaRecoveryCodes(@Auth() auth: AuthContext, @Body(new ZodPipe(mfaRegenerateSchema)) body: { code: string }, @Meta() meta: RequestMeta): Promise<MfaEnableResponse> {
    const result = await this.mfa.regenerateRecoveryCodes(auth.userId, body.code);
    await this.auth.recordSecurityEvent(auth, 'auth.mfa_recovery_codes_regenerated', meta);
    return result;
  }

  // ───── Signed-in devices ─────

  @AllowRestricted()
  @Get('sessions')
  sessions(@Auth() auth: AuthContext): Promise<SessionSummary[]> {
    return this.auth.listSessions(auth);
  }

  @AllowRestricted()
  @HttpCode(200)
  @Post('sessions/revoke-others')
  async revokeOthers(@Auth() auth: AuthContext, @Meta() meta: RequestMeta): Promise<{ revoked: number }> {
    return { revoked: await this.auth.revokeSessions(auth, 'others', meta) };
  }

  @AllowRestricted()
  @HttpCode(204)
  @Delete('sessions/:id')
  async revokeSession(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.revokeSessions(auth, { id }, meta);
  }

  private refreshCookie(req: AuthedRequest): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  }
}
