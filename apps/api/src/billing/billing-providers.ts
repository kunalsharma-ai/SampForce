import { Inject, Injectable } from '@nestjs/common';
import type { BillingProviderKey } from '@dealflow/types';
import { API_ENV, type ApiEnv } from '../common/env';
import { type BillingAdapter, RazorpayAdapter, StripeAdapter } from './providers';

@Injectable()
export class BillingProviders {
  private readonly adapters: Record<BillingProviderKey, BillingAdapter>;
  private readonly online: boolean;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.adapters = { STRIPE: new StripeAdapter(env), RAZORPAY: new RazorpayAdapter(env) };
    this.online = env.ONLINE_PAYMENTS_ENABLED;
  }

  /** Whether new subscriptions can be bought through this provider: online payments on and keys set. */
  sells(key: BillingProviderKey): boolean {
    return this.online && this.adapters[key].configured;
  }

  get(key: BillingProviderKey): BillingAdapter {
    return this.adapters[key];
  }
}
