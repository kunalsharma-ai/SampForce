import { type ApiEnv, loadApiEnv } from '@dealflow/config';

export const API_ENV = Symbol('API_ENV');
export type { ApiEnv };

export const envProvider = { provide: API_ENV, useFactory: (): ApiEnv => loadApiEnv() };
