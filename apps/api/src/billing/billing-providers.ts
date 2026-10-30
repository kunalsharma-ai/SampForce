import { Inject, Injectable } from '@nestjs/common';
import type { BillingProviderKey } from '@dealflow/types';
import { API_ENV, type ApiEnv } from '../common/env';
import { type BillingAdapter, RazorpayAdapter, StripeAdapter } from './providers';

@Injectable()
export class BillingProviders {
  private readonly adapters: Record<BillingProviderKey, BillingAdapter>;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.adapters = { STRIPE: new StripeAdapter(env), RAZORPAY: new RazorpayAdapter(env) };
  }

  get(key: BillingProviderKey): BillingAdapter {
    return this.adapters[key];
  }
}
