import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  type LoginInput,
  loginSchema,
  type MeResponse,
  type RegisterInput,
  registerSchema,
  type SwitchTenantInput,
  switchTenantSchema,
} from '@dealflow/types';
import { Auth, type AuthContext, type AuthedRequest, Meta, Public, type RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { clearAuthCookies, REFRESH_COOKIE, setAccessCookie, setAuthCookies } from './cookies';

const AUTH_LIMIT = { default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
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
  ): Promise<{ tenantId: string }> {
    const tokens = await this.auth.login(body, meta);
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

  @Get('me')
  me(@Auth() auth: AuthContext): Promise<MeResponse> {
    return this.auth.me(auth);
  }

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

  private refreshCookie(req: AuthedRequest): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  }
}
