import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  changePlanSchema,
  type CheckoutInput,
  checkoutSchema,
  seatsSchema,
  supportGrantSchema,
  trialSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { BillingService } from './billing.service';
import { WorkspaceService } from './workspace.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermissions('billing:read')
  overview(@Auth() auth: AuthContext) {
    return this.billing.overview(auth);
  }

  @Get('invoices')
  @RequirePermissions('billing:read')
  invoices(@Auth() auth: AuthContext) {
    return this.billing.invoices(auth);
  }

  @Post('checkout')
  @HttpCode(200)
  @RequirePermissions('billing:manage')
  checkout(@Auth() auth: AuthContext, @Body(new ZodPipe(checkoutSchema)) body: CheckoutInput, @Meta() meta: RequestMeta) {
    return this.billing.checkout(auth, body, meta);
  }

  @Post('portal')
  @HttpCode(200)
  @RequirePermissions('billing:manage')
  portal(@Auth() auth: AuthContext) {
    return this.billing.portal(auth);
  }

  @Post('seats')
  @HttpCode(200)
  @RequirePermissions('billing:manage')
  seats(@Auth() auth: AuthContext, @Body(new ZodPipe(seatsSchema)) body: z.infer<typeof seatsSchema>, @Meta() meta: RequestMeta) {
    return this.billing.setSeats(auth, body.seats, meta);
  }

  @Post('plan')
  @HttpCode(200)
  @RequirePermissions('billing:manage')
  plan(@Auth() auth: AuthContext, @Body(new ZodPipe(changePlanSchema)) body: z.infer<typeof changePlanSchema>, @Meta() meta: RequestMeta) {
    return this.billing.changePlan(auth, body.planCode, body.interval, meta);
  }

  @Post('cancel')
  @HttpCode(200)
  @RequirePermissions('billing:manage')
  cancel(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.billing.setCancel(auth, true, meta);
  }

  @Post('resume')
  @HttpCode(200)
  @RequirePermissions('billing:manage')
  resume(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.billing.setCancel(auth, false, meta);
  }

  @Post('trial')
  @HttpCode(200)
  @RequirePermissions('billing:manage')
  trial(@Auth() auth: AuthContext, @Body(new ZodPipe(trialSchema)) body: z.infer<typeof trialSchema>, @Meta() meta: RequestMeta) {
    return this.billing.startTrial(auth, body.planCode, meta);
  }

  /** Provider webhooks: authenticated by signature over the raw body, not by session. */
  @Post('webhooks/stripe')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  stripe(@Req() req: RawBodyRequest<Request>) {
    return this.billing.handleWebhook('STRIPE', req.rawBody, req.headers);
  }

  @Post('webhooks/razorpay')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  razorpay(@Req() req: RawBodyRequest<Request>) {
    return this.billing.handleWebhook('RAZORPAY', req.rawBody, req.headers);
  }
}

@Controller()
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get('onboarding')
  @RequirePermissions('dashboard:read')
  onboarding(@Auth() auth: AuthContext) {
    return this.workspace.onboarding(auth);
  }

  @Post('onboarding/dismiss')
  @HttpCode(204)
  @RequirePermissions('tenant:manage')
  dismiss(@Auth() auth: AuthContext, @Body(new ZodPipe(z.object({ dismissed: z.boolean().default(true) }))) body: { dismissed: boolean }) {
    return this.workspace.dismissOnboarding(auth, body.dismissed);
  }

  @Get('support-access')
  @RequirePermissions('tenant:manage')
  grants(@Auth() auth: AuthContext) {
    return this.workspace.supportGrants(auth);
  }

  @Post('support-access')
  @RequirePermissions('tenant:manage')
  grant(@Auth() auth: AuthContext, @Body(new ZodPipe(supportGrantSchema)) body: z.infer<typeof supportGrantSchema>, @Meta() meta: RequestMeta) {
    return this.workspace.grantSupport(auth, body, meta);
  }

  @Delete('support-access/:id')
  @HttpCode(204)
  @RequirePermissions('tenant:manage')
  revoke(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.workspace.revokeSupport(auth, id, meta);
  }
}

/** What the public pricing page shows. Prices are labelled a preview until PRICING_PUBLISHED is set. */
@Controller('public/pricing')
export class PublicPricingController {
  constructor(
    private readonly billing: BillingService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get()
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  pricing() {
    return {
      published: this.env.PRICING_PUBLISHED,
      currency: 'USD',
      trialDays: this.env.TRIAL_DAYS,
      graceDays: this.env.BILLING_GRACE_DAYS,
      salesContact: this.env.SALES_CONTACT_EMAIL ?? null,
      plans: this.billing.catalog().map(({ checkout, ...p }) => ({ ...p, buyOnline: Object.values(checkout).some((c) => c.MONTH || c.YEAR) })),
    };
  }
}
