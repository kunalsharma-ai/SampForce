import { z } from 'zod';

// ───────────── Client health score (ADR 0074, C5) ─────────────

/**
 * The signals behind a client's health score. Each is measured from data the platform already stores, scored from 0
 * to 1, and multiplied by its weight. A signal that does not apply to the client (mobile access never switched on, no
 * workspace limits to fill) is left out and the score is taken over the weights that do apply.
 */
export const HEALTH_SIGNALS = ['login', 'workspaces', 'features', 'mobile', 'payment', 'support', 'subscription'] as const;
export type ClientHealthKey = (typeof HEALTH_SIGNALS)[number];

export const HEALTH_BANDS = ['HEALTHY', 'AT_RISK', 'CRITICAL'] as const;
export type ClientHealthBand = (typeof HEALTH_BANDS)[number];

export interface HealthSettings {
  /** Points each signal is worth; 0 leaves a signal out. */
  weights: Record<ClientHealthKey, number>;
  /** Scores at or above `healthy` are Healthy, at or above `atRisk` At risk, and anything lower Critical. */
  thresholds: { healthy: number; atRisk: number };
}

export const DEFAULT_HEALTH_SETTINGS: HealthSettings = {
  weights: { login: 20, workspaces: 15, features: 15, mobile: 10, payment: 20, support: 10, subscription: 10 },
  thresholds: { healthy: 70, atRisk: 40 },
};

const weight = z.number().int().min(0).max(100);

/** PUT /operator/settings/health. */
export const healthSettingsSchema = z
  .object({
    weights: z.object({ login: weight, workspaces: weight, features: weight, mobile: weight, payment: weight, support: weight, subscription: weight }).strict(),
    thresholds: z.object({ healthy: z.number().int().min(1).max(100), atRisk: z.number().int().min(0).max(99) }).strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Object.values(v.weights).every((w) => w === 0)) ctx.addIssue({ code: 'custom', path: ['weights'], message: 'Give at least one signal some weight.' });
    if (v.thresholds.atRisk >= v.thresholds.healthy) ctx.addIssue({ code: 'custom', path: ['thresholds', 'atRisk'], message: 'The At risk score must be lower than the Healthy score.' });
  });
export type HealthSettingsInput = z.infer<typeof healthSettingsSchema>;

export function healthBandOf(score: number, t: HealthSettings['thresholds'] = DEFAULT_HEALTH_SETTINGS.thresholds): ClientHealthBand {
  return score >= t.healthy ? 'HEALTHY' : score >= t.atRisk ? 'AT_RISK' : 'CRITICAL';
}

/** One signal of a client's score, with the figure it was measured from. */
export interface ClientHealthSignal {
  key: ClientHealthKey;
  weight: number;
  /** False when the signal does not apply to this client; it then adds no points and its weight is not counted. */
  applies: boolean;
  /** 0 to 1. */
  ratio: number;
  /** Points out of the score of 100, after the weights that apply are scaled to 100. */
  points: number;
  /** The most points this signal could add. */
  maxPoints: number;
  /** The raw figure: a count out of a total (people who signed in, workspaces used, open tickets) or a status. */
  count: number | null;
  total: number | null;
  status: string | null;
}

export interface ClientHealth {
  score: number;
  band: ClientHealthBand;
  /** When it was worked out. */
  at: string;
  signals: ClientHealthSignal[];
  /** One score per day the worker measured it, oldest first, up to 30. */
  history: { day: string; score: number }[];
}

/** A client's score in lists: null until the worker first measures it. */
export interface ClientHealthSummary {
  score: number;
  band: ClientHealthBand;
}
