import { z } from 'zod';

/*
 * Revenue attribution (ADR 0061). Every won deal (or won RFQ that never became a deal) has exactly one revenue record,
 * and its credits split the record between people in shares that always sum to 100%. Individual totals add up each
 * person's share; team and organisation totals add up shares too, so the same revenue is never counted twice, however
 * many people helped win it.
 *
 * The workspace rule (Tenant.revenueAttribution, edited in Settings → CRM configuration) decides how a new record is
 * split. Credits someone set by hand on a record are kept when the rule changes.
 */

export const ATTRIBUTION_MODELS = ['LEAD_GENERATION', 'DEAL_CLOSURE', 'ACCOUNT_OWNERSHIP', 'SHARED'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

/** Why a person holds a share: the role the rule gave them, or MANUAL for a split someone entered. */
export const CREDIT_ROLES = ['LEAD_GENERATION', 'DEAL_CLOSURE', 'ACCOUNT_OWNERSHIP', 'SUPPORT', 'MANUAL'] as const;
export type CreditRole = (typeof CREDIT_ROLES)[number];

const pct = z.coerce.number().min(0).max(100);

export const attributionRuleSchema = z
  .object({
    model: z.enum(ATTRIBUTION_MODELS),
    /** Shares for the SHARED model; the other models give 100% to one role. */
    leadCreatorPct: pct.default(0),
    closerPct: pct.default(100),
    accountOwnerPct: pct.default(0),
    supportersPct: pct.default(0),
  })
  .strict()
  .refine((r) => r.model !== 'SHARED' || Math.abs(r.leadCreatorPct + r.closerPct + r.accountOwnerPct + r.supportersPct - 100) < 0.001, {
    message: 'The shares must add up to 100%',
    path: ['closerPct'],
  });
export type AttributionRule = z.infer<typeof attributionRuleSchema>;

/** Until an administrator picks a rule, the person who closed the deal gets the whole deal. */
export const DEFAULT_ATTRIBUTION_RULE: AttributionRule = { model: 'DEAL_CLOSURE', leadCreatorPct: 0, closerPct: 100, accountOwnerPct: 0, supportersPct: 0 };

/** The stored rule, or the default when none is stored or it no longer parses. */
export function attributionRuleOf(stored: unknown): AttributionRule {
  const parsed = attributionRuleSchema.safeParse(stored ?? undefined);
  return parsed.success ? parsed.data : DEFAULT_ATTRIBUTION_RULE;
}

export interface CreditPeople {
  /** Who generated the lead (Company.createdById). */
  creatorId?: string | null;
  /** Who owns the account now (Company.ownerId). */
  ownerId?: string | null;
  /** Who closed it (the deal owner, or the RFQ owner). */
  closerId?: string | null;
  supporters?: (string | null | undefined)[];
}

export interface Credit {
  /** null when nobody can be credited (an unowned deal): the organisation still counts it, nobody personally. */
  userId: string | null;
  roles: CreditRole[];
  /** 0 to 100, two decimals; the credits of a record always sum to exactly 100. */
  percent: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Splits a record by the rule. A share whose person is missing goes to the closer, else the account owner, else the
 * lead creator; supporters share theirs equally. One person holding several roles gets one credit with their
 * shares added.
 */
export function attributionCredits(rule: AttributionRule, people: CreditPeople): Credit[] {
  const shares: { role: CreditRole; pct: number }[] =
    rule.model === 'LEAD_GENERATION'
      ? [{ role: 'LEAD_GENERATION', pct: 100 }]
      : rule.model === 'ACCOUNT_OWNERSHIP'
        ? [{ role: 'ACCOUNT_OWNERSHIP', pct: 100 }]
        : rule.model === 'DEAL_CLOSURE'
          ? [{ role: 'DEAL_CLOSURE', pct: 100 }]
          : [
              { role: 'LEAD_GENERATION', pct: rule.leadCreatorPct },
              { role: 'DEAL_CLOSURE', pct: rule.closerPct },
              { role: 'ACCOUNT_OWNERSHIP', pct: rule.accountOwnerPct },
              { role: 'SUPPORT', pct: rule.supportersPct },
            ];
  const fallback = people.closerId ?? people.ownerId ?? people.creatorId ?? null;
  const supporters = [...new Set((people.supporters ?? []).filter((s): s is string => !!s))];
  const raw: { userId: string | null; role: CreditRole; pct: number }[] = [];
  for (const s of shares) {
    if (s.pct <= 0) continue;
    if (s.role === 'SUPPORT') {
      if (!supporters.length) raw.push({ userId: fallback, role: 'SUPPORT', pct: s.pct });
      else for (const u of supporters) raw.push({ userId: u, role: 'SUPPORT', pct: s.pct / supporters.length });
      continue;
    }
    const who = s.role === 'LEAD_GENERATION' ? people.creatorId : s.role === 'ACCOUNT_OWNERSHIP' ? people.ownerId : people.closerId;
    raw.push({ userId: who ?? fallback, role: s.role, pct: s.pct });
  }
  return normaliseCredits(raw.map((r) => ({ userId: r.userId, roles: [r.role], percent: r.pct })));
}

/** Merges credits of the same person and rounds them so they sum to exactly 100 (the remainder goes to the largest). */
export function normaliseCredits(list: Credit[]): Credit[] {
  const byUser = new Map<string, Credit>();
  for (const c of list) {
    const key = c.userId ?? '';
    const cur = byUser.get(key);
    if (cur) {
      cur.percent += c.percent;
      for (const r of c.roles) if (!cur.roles.includes(r)) cur.roles.push(r);
    } else byUser.set(key, { userId: c.userId, roles: [...c.roles], percent: c.percent });
  }
  const out = [...byUser.values()].filter((c) => c.percent > 0);
  if (!out.length) return [{ userId: null, roles: ['DEAL_CLOSURE'], percent: 100 }];
  const total = out.reduce((a, c) => a + c.percent, 0);
  for (const c of out) c.percent = r2((c.percent / total) * 100);
  out.sort((a, b) => b.percent - a.percent || (a.userId ?? '').localeCompare(b.userId ?? ''));
  out[0]!.percent = r2(out[0]!.percent + 100 - out.reduce((a, c) => a + c.percent, 0));
  return out;
}

/** A split someone enters by hand on one record. */
export const creditSplitSchema = z
  .object({
    credits: z
      .array(z.object({ userId: z.string().uuid(), percent: z.coerce.number().gt(0).max(100) }).strict())
      .min(1)
      .max(20),
  })
  .strict()
  .refine((s) => Math.abs(s.credits.reduce((a, c) => a + c.percent, 0) - 100) < 0.01, { message: 'The shares must add up to 100%', path: ['credits'] })
  .refine((s) => new Set(s.credits.map((c) => c.userId)).size === s.credits.length, { message: 'Each person can appear once', path: ['credits'] });
export type CreditSplitInput = z.infer<typeof creditSplitSchema>;

/** One person's share of an amount, rounded to cents. */
export function shareOf(amount: number, percent: number): number {
  return r2((amount * percent) / 100);
}
