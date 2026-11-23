import { z } from 'zod';

/**
 * The Console activity feed (ADR 0074, C3): what happened across SampForce, newest first. It reads the platform audit
 * log (what operators did) and the platform's own records (clients joining, invoices, tickets, failed payments); it
 * never reads CRM records. Each operator sees only the kinds of activity their role may act on.
 */
export const CONSOLE_ACTIVITY_CATEGORIES = ['clients', 'workspaces', 'billing', 'support', 'security', 'console'] as const;
export type ConsoleActivityCategory = (typeof CONSOLE_ACTIVITY_CATEGORIES)[number];

export const CONSOLE_ACTIVITY_KINDS = [
  'client.joined',
  'workspace.created',
  'invoice.issued',
  'invoice.paid',
  'subscription.past_due',
  'ticket.submitted',
  'signin.unusual',
  'operator.action',
] as const;
export type ConsoleActivityKind = (typeof CONSOLE_ACTIVITY_KINDS)[number];

export const CONSOLE_ACTIVITY_CATEGORY_OF: Record<Exclude<ConsoleActivityKind, 'operator.action'>, ConsoleActivityCategory> = {
  'client.joined': 'clients',
  'workspace.created': 'workspaces',
  'invoice.issued': 'billing',
  'invoice.paid': 'billing',
  'subscription.past_due': 'billing',
  'ticket.submitted': 'support',
  'signin.unusual': 'security',
};

/** The permission an operator needs to see each category. */
export const CONSOLE_ACTIVITY_PERMISSION: Record<ConsoleActivityCategory, string> = {
  clients: 'clients.view',
  workspaces: 'workspaces.view',
  billing: 'billing.view',
  support: 'support.handle',
  security: 'security.manage',
  console: 'audit.view',
};

export const consoleActivityQuerySchema = z.object({
  /** Comma-separated categories; all the caller may see when left out. */
  categories: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(CONSOLE_ACTIVITY_CATEGORIES)).optional()),
  tenantId: z.string().uuid().optional(),
  /** Items older than this time, for the next page. */
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ConsoleActivityQuery = z.infer<typeof consoleActivityQuerySchema>;

export interface ConsoleActivityItem {
  /** Stable across pages: kind and source row, such as "invoice.paid:<invoice id>". */
  id: string;
  kind: ConsoleActivityKind;
  category: ConsoleActivityCategory;
  at: string;
  client: { id: string; name: string } | null;
  /** The operator who did it, for operator actions. */
  operator: { id: string; name: string } | null;
  /** Kind-specific facts the page writes its sentence from (amounts, numbers, names, the audit action). */
  data: Record<string, string | number | boolean | null>;
  /** Where the item opens in the Console. */
  link: string | null;
}

export interface ConsoleActivityPage {
  items: ConsoleActivityItem[];
  /** Pass as `before` for the next page; null at the end. */
  next: string | null;
}
