import { BadRequestException, Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { type WhatsappConnectInput, whatsappConnectSchema, whatsappConsentSchema, type WhatsappSendInput, whatsappSendSchema } from '@dealflow/types';
import type { z } from 'zod';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AppError } from './apps.service';
import { WhatsappService } from './whatsapp.service';

const uuid = new ParseUUIDPipe({ version: '4' });

async function plain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw new BadRequestException({ code: 'APP_ERROR', message: e.message });
    throw e;
  }
}

/** WhatsApp Business: the workspace's credentials, contact conversations and consent, sending, and Meta's webhook. */
@Controller('apps/whatsapp')
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  /** Saves the number id, business account id, access token and App Secret after a read proves them. */
  @Post('keys')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('integrations:manage')
  keys(@Auth() auth: AuthContext, @Body(new ZodPipe(whatsappConnectSchema)) body: WhatsappConnectInput, @Meta() meta: RequestMeta) {
    return plain(() => this.whatsapp.connect(auth, body, meta));
  }

  @Get('templates')
  @RequirePermissions('activities:read')
  templates(@Auth() auth: AuthContext) {
    return plain(() => this.whatsapp.templates(auth));
  }

  @Get('contacts/:contactId')
  @RequirePermissions('contacts:read')
  thread(@Auth() auth: AuthContext, @Param('contactId', uuid) contactId: string) {
    return this.whatsapp.thread(auth, contactId);
  }

  @Post('consents')
  @HttpCode(200)
  @RequirePermissions('contacts:write')
  consent(@Auth() auth: AuthContext, @Body(new ZodPipe(whatsappConsentSchema)) body: z.infer<typeof whatsappConsentSchema>, @Meta() meta: RequestMeta) {
    return this.whatsapp.recordConsent(auth, body, meta);
  }

  @Delete('consents/:contactId')
  @HttpCode(200)
  @RequirePermissions('contacts:write')
  revoke(@Auth() auth: AuthContext, @Param('contactId', uuid) contactId: string, @Meta() meta: RequestMeta) {
    return this.whatsapp.revokeConsent(auth, contactId, meta);
  }

  /** One message to one contact; needs confirm: true. */
  @Post('messages')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions('activities:write')
  send(@Auth() auth: AuthContext, @Body(new ZodPipe(whatsappSendSchema)) body: WhatsappSendInput, @Meta() meta: RequestMeta) {
    return plain(() => this.whatsapp.send(auth, body, meta));
  }

  /** Meta's webhook verification request (hub.mode=subscribe). */
  @Get('webhooks/:hookId')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('content-type', 'text/plain')
  verify(@Param('hookId') hookId: string, @Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    return this.whatsapp.verifySubscription(hookId, { mode, token, challenge });
  }

  /** Signed deliveries from Meta (X-Hub-Signature-256 with the workspace's App Secret). */
  @Post('webhooks/:hookId')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  webhook(@Param('hookId') hookId: string, @Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    return this.whatsapp.webhook(hookId, req.rawBody, signature);
  }
}
