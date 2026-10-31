import { Body, Controller, ForbiddenException, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { extensionLoginMfaSchema, extensionLoginSchema, type ExtensionTokenCreated } from '@dealflow/types';
import type { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { Meta, Public, type RequestMeta } from '../common/auth-context';
import { CrossSite } from '../common/origin.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ExtensionService } from './extension.service';

const LIMIT = { default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };
type SignedIn = ExtensionTokenCreated;
type Challenge = { mfaRequired: true; challenge: string };

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
  ) {}

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
  async login(@Body(new ZodPipe(extensionLoginSchema)) body: z.infer<typeof extensionLoginSchema>, @Meta() meta: RequestMeta): Promise<SignedIn | Challenge> {
    const r = await this.auth.extensionSignIn({ email: body.email, password: body.password }, meta).catch((e) => this.ssoHint(e));
    if ('mfaRequired' in r) return r;
    return this.connect(r, body.name, meta);
  }

  @Post('mfa')
  @HttpCode(200)
  @Throttle(LIMIT)
  async mfa(@Body(new ZodPipe(extensionLoginMfaSchema)) body: z.infer<typeof extensionLoginMfaSchema>, @Meta() meta: RequestMeta): Promise<SignedIn> {
    const r = await this.auth.extensionVerifyMfa(body.challenge, body.code, meta).catch((e) => this.ssoHint(e));
    return this.connect(r, body.name, meta);
  }
}
