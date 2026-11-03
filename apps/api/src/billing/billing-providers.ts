import { Inject, Injectable } from '@nestjs/common';
import type { BillingProviderKey } from '@dealflow/types';
import { API_ENV, type ApiEnv } from '../common/env';
import { type BillingAdapter, RazorpayAdapter, StripeAdapter } from './providers';

@Injectable()
export class BillingProviders {
  private readonly adapters: Record<BillingProviderKey, BillingAdapter>;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.adapters = { STRIPE: new StripeAdapter(env), RAZORPAY: new RazorpayAdapter(env) };
  }

  /**
   * Whether new subscriptions can be bought through this provider: online payments on and keys set. Read at call time,
   * so switching online payments on or off in the operator console applies within seconds (ADR 0053).
   */
  sells(key: BillingProviderKey): boolean {
    return this.env.ONLINE_PAYMENTS_ENABLED && this.adapters[key].configured;
  }

  get(key: BillingProviderKey): BillingAdapter {
    return this.adapters[key];
  }
}
