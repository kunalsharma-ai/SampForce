import { BadRequestException, Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { smsConsentSchema, type SmsSendInput, smsSendSchema, type TwilioConnectInput, twilioConnectSchema } from '@dealflow/types';
import type { z } from 'zod';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AppError } from './apps.service';
import { TwilioService } from './twilio.service';

const uuid = new ParseUUIDPipe({ version: '4' });

async function plain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw new BadRequestException({ code: 'APP_ERROR', message: e.message });
    throw e;
  }
}

/** Twilio posts application/x-www-form-urlencoded; the signature covers exactly these name/value pairs. */
function formParams(req: RawBodyRequest<Request>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!req.rawBody || !String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) return out;
  for (const [k, v] of new URLSearchParams(req.rawBody.toString('utf8'))) out[k] = v;
  return out;
}

/** SMS through the workspace's Twilio number: credentials, contact conversations and consent, sending, and Twilio's requests. */
@Controller('apps/twilio')
export class TwilioController {
  constructor(private readonly twilio: TwilioService) {}

  /** Saves the Account SID, Auth Token and number after reads prove them. Sends nothing. */
  @Post('keys')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('integrations:manage')
  keys(@Auth() auth: AuthContext, @Body(new ZodPipe(twilioConnectSchema)) body: TwilioConnectInput, @Meta() meta: RequestMeta) {
    return plain(() => this.twilio.connect(auth, body, meta));
  }

  @Get('contacts/:contactId')
  @RequirePermissions('contacts:read')
  thread(@Auth() auth: AuthContext, @Param('contactId', uuid) contactId: string) {
    return this.twilio.thread(auth, contactId);
  }

  @Post('consents')
  @HttpCode(200)
  @RequirePermissions('contacts:write')
  consent(@Auth() auth: AuthContext, @Body(new ZodPipe(smsConsentSchema)) body: z.infer<typeof smsConsentSchema>, @Meta() meta: RequestMeta) {
    return this.twilio.recordConsent(auth, body, meta);
  }

  @Delete('consents/:contactId')
  @HttpCode(200)
  @RequirePermissions('contacts:write')
  revoke(@Auth() auth: AuthContext, @Param('contactId', uuid) contactId: string, @Meta() meta: RequestMeta) {
    return this.twilio.revokeConsent(auth, contactId, meta);
  }

  /** One SMS to one contact; needs confirm: true. */
  @Post('messages')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions('activities:write')
  send(@Auth() auth: AuthContext, @Body(new ZodPipe(smsSendSchema)) body: SmsSendInput, @Meta() meta: RequestMeta) {
    return plain(() => this.twilio.send(auth, body, meta));
  }

  /** "A message comes in" webhook for the workspace's number (signed with X-Twilio-Signature). */
  @Post('webhooks/:hookId/inbound')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Header('content-type', 'text/xml')
  inbound(@Param('hookId') hookId: string, @Req() req: RawBodyRequest<Request>, @Headers('x-twilio-signature') signature?: string) {
    return this.twilio.inbound(hookId, formParams(req), signature);
  }

  /** Status callbacks for messages SampForce sent (signed with X-Twilio-Signature). */
  @Post('webhooks/:hookId/status')
  @Public()
  @SkipThrottle()
  @HttpCode(204)
  async status(@Param('hookId') hookId: string, @Req() req: RawBodyRequest<Request>, @Headers('x-twilio-signature') signature?: string) {
    await this.twilio.status(hookId, formParams(req), signature);
  }
}
