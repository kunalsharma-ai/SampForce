import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  type MobileAccessRequestInput,
  mobileAccessRequestSchema,
  type MobileActivationInput,
  mobileActivationSchema,
  type MobileLoginInput,
  mobileLoginSchema,
  type MobileMfaVerifyInput,
  mobileMfaVerifySchema,
  type MobileRefreshInput,
  mobileRefreshSchema,
  mobileSwitchWorkspaceSchema,
  type OperatorMobileActionInput,
  operatorMobileActionSchema,
  type OperatorMobileLimitsInput,
  operatorMobileLimitsSchema,
} from '@dealflow/types';
import { AllowRestricted, Auth, type AuthContext, Meta, MobileAccess, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { Operator, type OperatorContext, OperatorGuard, OperatorRoles } from '../operator/operator-auth';
import { MobileAccessService } from './mobile-access.service';
import { MobileAuthService } from './mobile-auth.service';

const AUTH_LIMIT = { default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };

/**
 * The phone app's own sign-in (ADR 0072). Tokens travel in the body, never in cookies, so these routes need no CSRF
 * origin check: a web page cannot read the answer, and the refresh token only ever lives in the phone's secure storage.
 */
@Controller('mobile/auth')
export class MobileAuthController {
  constructor(private readonly mobile: MobileAuthService) {}

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodPipe(mobileLoginSchema)) body: MobileLoginInput, @Meta() meta: RequestMeta) {
    return this.mobile.login({ email: body.email, password: body.password }, body.device, meta);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('mfa/verify')
  verifyMfa(@Body(new ZodPipe(mobileMfaVerifySchema)) body: MobileMfaVerifyInput, @Meta() meta: RequestMeta) {
    return this.mobile.verifyMfa(body.challenge, body.code, body.device, meta);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodPipe(mobileRefreshSchema)) body: MobileRefreshInput, @Meta() meta: RequestMeta) {
    return this.mobile.refresh(body.refreshToken, meta);
  }

  @MobileAccess()
  @AllowRestricted()
  @HttpCode(204)
  @Post('logout')
  async logout(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    await this.mobile.logout(auth, meta);
  }

  @MobileAccess()
  @HttpCode(200)
  @Post('switch-workspace')
  switchWorkspace(@Auth() auth: AuthContext, @Body(new ZodPipe(mobileSwitchWorkspaceSchema)) body: { tenantId: string }, @Meta() meta: RequestMeta) {
    return this.mobile.switchWorkspace(auth, body.tenantId, meta);
  }
}

@Controller('mobile')
export class MobileSessionController {
  constructor(private readonly mobile: MobileAuthService) {}

  /** Who is signed in on the phone, their organisation and workspace level. */
  @MobileAccess()
  @Get('session')
  session(@Auth() auth: AuthContext) {
    return this.mobile.session(auth);
  }
}

/** The Super Workspace's side: ask for mobile access, switch it on or off, see and sign out phones. */
@Controller('mobile-access')
export class MobileAccessController {
  constructor(private readonly access: MobileAccessService) {}

  @Get()
  @RequirePermissions('tenant:manage')
  state(@Auth() auth: AuthContext) {
    return this.access.state(auth);
  }

  @Post('request')
  @HttpCode(200)
  @RequirePermissions('tenant:manage')
  request(@Auth() auth: AuthContext, @Body(new ZodPipe(mobileAccessRequestSchema)) body: MobileAccessRequestInput, @Meta() meta: RequestMeta) {
    return this.access.request(auth, body.message, meta);
  }

  @Put('activation')
  @RequirePermissions('tenant:manage')
  activation(@Auth() auth: AuthContext, @Body(new ZodPipe(mobileActivationSchema)) body: MobileActivationInput, @Meta() meta: RequestMeta) {
    return this.access.setActivated(auth, body.activated, meta);
  }

  @Get('devices')
  @RequirePermissions('tenant:manage')
  devices(@Auth() auth: AuthContext) {
    return this.access.devices(auth);
  }

  @Delete('devices/:id')
  @RequirePermissions('tenant:manage')
  signOut(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.access.signOutDevice(auth, id, meta);
  }
}

const ip = (req: Request) => req.ip ?? null;

/** Console Admin: Mobile Application Management. `@Public()` only skips the workspace guard; OperatorGuard protects it. */
@Controller('operator/mobile')
@Public()
@UseGuards(OperatorGuard)
export class OperatorMobileController {
  constructor(private readonly access: MobileAccessService) {}

  @Get()
  overview(@Operator() op: OperatorContext, @Req() req: Request) {
    return this.access.overview(op, ip(req));
  }

  @Get(':tenantId')
  detail(@Operator() op: OperatorContext, @Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Req() req: Request) {
    return this.access.detail(op, tenantId, ip(req));
  }

  @Post(':tenantId/decision')
  @HttpCode(200)
  @OperatorRoles('ADMIN')
  decide(@Operator() op: OperatorContext, @Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Body(new ZodPipe(operatorMobileActionSchema)) body: OperatorMobileActionInput, @Req() req: Request) {
    return this.access.decide(op, tenantId, body.action, body.reason, ip(req));
  }

  @Put(':tenantId/limits')
  @OperatorRoles('ADMIN')
  limits(@Operator() op: OperatorContext, @Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Body(new ZodPipe(operatorMobileLimitsSchema)) body: OperatorMobileLimitsInput, @Req() req: Request) {
    return this.access.setLimits(op, tenantId, body.maxDevices, body.reason, ip(req));
  }
}
