import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type CloseCompanyInput, closeCompanySchema, type CompanyClosed, type CompanyCloseImpact } from '@dealflow/types';
import { clearAuthCookies } from '../auth/cookies';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { ConfirmPassword } from '../common/password-confirmation';
import { ZodPipe } from '../common/zod.pipe';
import { CompanyClosureService } from './company-closure.service';

/** Closing the company (workspace redesign W7): what it stops, then the typed name, the password and a second yes. */
@Controller('tenants/current')
export class CompanyClosureController {
  constructor(
    private readonly closure: CompanyClosureService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get('close-impact')
  @RequirePermissions('tenant:manage')
  impact(@Auth() auth: AuthContext): Promise<CompanyCloseImpact> {
    return this.closure.impact(auth);
  }

  // The password, then the typed name and `understood: true` (the second confirmation). Not a workspace's Delete
  // action: only an owner may close the company, which the service checks.
  @ConfirmPassword({ deletes: false })
  @Post('close')
  @HttpCode(200)
  @RequirePermissions('tenant:manage')
  async close(@Auth() auth: AuthContext, @Body(new ZodPipe(closeCompanySchema)) body: CloseCompanyInput, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response): Promise<CompanyClosed> {
    const result = await this.closure.close(auth, body, meta);
    clearAuthCookies(res, this.env);
    return result;
  }
}
