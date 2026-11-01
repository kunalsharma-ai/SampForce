import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { type PaymentsConnectInput, paymentsConnectSchema } from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AppError } from './apps.service';
import { CardPaymentsService } from './card-payments.service';

/** Card payments on proposals: saving the workspace's keys, payment history, and the provider webhook. */
@Controller('apps/payments')
export class CardPaymentsController {
  constructor(private readonly payments: CardPaymentsService) {}

  /** Saves Stripe or Razorpay keys after a live read proves them. Keys are sealed and never returned. */
  @Post('keys')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('integrations:manage')
  async keys(@Auth() auth: AuthContext, @Body(new ZodPipe(paymentsConnectSchema)) body: PaymentsConnectInput, @Meta() meta: RequestMeta) {
    try {
      return await this.payments.connect(auth, body, meta);
    } catch (e) {
      if (e instanceof AppError) throw new BadRequestException({ code: 'APP_ERROR', message: e.message });
      throw e;
    }
  }

  @Get('quotes/:quoteId')
  @RequirePermissions('quotes:read')
  forQuote(@Auth() auth: AuthContext, @Param('quoteId', new ParseUUIDPipe({ version: '4' })) quoteId: string) {
    return this.payments.listForQuote(auth, quoteId);
  }

  /** Stripe or Razorpay webhook for one workspace; checked with that workspace's own signing secret. */
  @Post('webhooks/:hookId')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  webhook(@Param('hookId') hookId: string, @Req() req: RawBodyRequest<Request>) {
    return this.payments.webhook(hookId, req.rawBody, req.headers);
  }
}
