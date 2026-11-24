// ───────────── Console Overview dashboard (ADR 0074, C5b) ─────────────

/** The 18 KPI cards, in their order on the page. */
export const CONSOLE_KPIS = [
  'clients.total',
  'clients.active',
  'clients.suspended',
  'clients.trial',
  'workspaces.super',
  'workspaces.manager',
  'workspaces.executive',
  'people.users',
  'people.active',
  'people.mobile',
  'revenue.subscriptions',
  'revenue.expiring',
  'revenue.mrr',
  'revenue.arr',
  'revenue.total',
  'revenue.outstanding',
  'revenue.failed',
  'support.open',
] as const;
export type ConsoleKpiKey = (typeof CONSOLE_KPIS)[number];

export interface ConsoleKpi {
  key: ConsoleKpiKey;
  value: number;
  /** Set for money: the value is in minor units of this currency. */
  currency: string | null;
  /** The value 30 days ago, from the daily snapshots; null until there is one. */
  previous: number | null;
  /** One value per day for the last 30 days, oldest first; null for a day with no snapshot. */
  series: (number | null)[];
}

/** Items in Action Required: each a count and the list it opens. Items with a count of 0 are hidden. */
export const CONSOLE_ACTIONS = ['overdue', 'expiring', 'failed', 'tickets', 'suspended', 'seats', 'mobile', 'providers'] as const;
export type ConsoleActionKey = (typeof CONSOLE_ACTIONS)[number];

export interface ConsoleDashboard {
  generatedAt: string;
  /** The currency the money figures and the revenue chart are in: the one with the most subscription revenue. */
  currency: string;
  /** Subscription revenue in other currencies, which the money figures above leave out. */
  otherCurrencies: { currency: string; mrrCents: number }[];
  actions: { key: ConsoleActionKey; count: number }[];
  kpis: ConsoleKpi[];
  /** New, churned (deactivated) and active clients per month, the last 12 months, oldest first. */
  growth: { month: string; new: number; churned: number; active: number }[];
  workspaces: { super: number; manager: number; executive: number };
  /** Per month, in `currency`: paid, still open and written off; MRR where a snapshot exists. */
  revenue: { month: string; paidCents: number; outstandingCents: number; failedCents: number; mrrCents: number | null }[];
  /** Active subscriptions per plan, split by billing cycle. */
  plans: { code: string; name: string; month: number; year: number }[];
  utilisation: {
    manager: { allocated: number; used: number };
    executive: { allocated: number; used: number };
    /** Clients using the most of what they may create. */
    top: { id: string; name: string; used: number; allocated: number }[];
  };
  mobile: { enabledClients: number; requested: number; seatsUsed: number; seatsAllocated: number | null; people: number };
  recentWorkspaces: { id: string; clientId: string; clientName: string; level: 'MANAGER' | 'EXECUTIVE'; name: string; createdAt: string }[];
}
