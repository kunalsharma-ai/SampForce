import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OWN_AI_KINDS, type OwnAiKind, type OwnAiSaveInput, ownAiSaveSchema, type OwnEmailSaveInput, ownEmailSaveSchema } from '@dealflow/types';
import { z } from 'zod';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { OwnServersService } from './own-servers.service';
import { ConfirmPassword } from '../common/password-confirmation';

const kindPipe = new ZodPipe(z.enum(OWN_AI_KINDS));

/** A workspace's own AI keys or AI server, and its own email server (ADR 0068). Workspace admins only. */
@Controller('own-servers')
@RequirePermissions('integrations:manage')
export class OwnServersController {
  constructor(private readonly own: OwnServersService) {}

  @Get('ai')
  ai(@Auth() auth: AuthContext) {
    return this.own.aiStatus(auth);
  }

  @Put('ai')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  saveAi(@Auth() auth: AuthContext, @Body(new ZodPipe(ownAiSaveSchema)) body: OwnAiSaveInput, @Meta() meta: RequestMeta) {
    return this.own.saveAi(auth, body, meta);
  }

  @ConfirmPassword()
  @Delete('ai')
  @HttpCode(200)
  removeAi(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.own.removeAi(auth, meta);
  }

  @Post('ai/:kind/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  testAi(@Auth() auth: AuthContext, @Param('kind', kindPipe) kind: OwnAiKind) {
    return this.own.testAi(auth, kind);
  }

  @Get('email')
  email(@Auth() auth: AuthContext) {
    return this.own.emailStatus(auth);
  }

  @Put('email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  saveEmail(@Auth() auth: AuthContext, @Body(new ZodPipe(ownEmailSaveSchema)) body: OwnEmailSaveInput, @Meta() meta: RequestMeta) {
    return this.own.saveEmail(auth, body, meta);
  }

  @ConfirmPassword()
  @Delete('email')
  @HttpCode(200)
  removeEmail(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.own.removeEmail(auth, meta);
  }

  @Post('email/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  testEmail(@Auth() auth: AuthContext) {
    return this.own.testEmail(auth);
  }
}
