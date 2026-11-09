import type { SampforceClient } from './client';
import { currentDbContext, type DbContext, dbContextStorage } from './scope';

/**
 * Workspace lookups for requests that arrive without one (public pages, webhooks). Each replaces a PostgreSQL
 * SECURITY INVOKER function that exposed exactly one row through a narrow policy; here the same narrow read runs in
 * a `lookup` context, which the guard only lets see documents matching the given token.
 */
type Client = Pick<SampforceClient, 'invitation' | 'leadForm' | 'subscription' | 'visitorSettings'>;

function scoped<T>(ctx: DbContext, fn: () => Promise<T>): Promise<T> {
  // Awaited inside run(): Prisma queries are lazy and would otherwise execute after the context has ended.
  return dbContextStorage.run(ctx, async () => await fn());
}

/** The workspace of an open, unexpired invitation (was app_invitation_tenant). */
export async function invitationTenant(prisma: Client, tokenHash: string): Promise<string | null> {
  const row = await scoped({ lookup: { Invitation: { tokenHash } } }, () =>
    prisma.invitation.findFirst({
      where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { tenantId: true },
    }),
  );
  return row?.tenantId ?? null;
}

/** The workspace of an active public lead form (was app_form_tenant). */
export async function formTenant(prisma: Client, publicToken: string): Promise<string | null> {
  const row = await scoped({ lookup: { LeadForm: { publicToken } } }, () =>
    prisma.leadForm.findFirst({ where: { publicToken, active: true }, select: { tenantId: true } }),
  );
  return row?.tenantId ?? null;
}

/** The workspace a billing provider's customer or subscription id belongs to (was app_billing_tenant). */
export async function billingTenant(prisma: Client, ref: string): Promise<string | null> {
  const byCustomer = await scoped({ lookup: { Subscription: { providerCustomerId: ref } } }, () =>
    prisma.subscription.findFirst({ where: { providerCustomerId: ref }, select: { tenantId: true } }),
  );
  if (byCustomer) return byCustomer.tenantId;
  const bySub = await scoped({ lookup: { Subscription: { providerSubscriptionId: ref } } }, () =>
    prisma.subscription.findFirst({ where: { providerSubscriptionId: ref }, select: { tenantId: true } }),
  );
  return bySub?.tenantId ?? null;
}

/** The workspace of an enabled website-visitor site key (was app_visitor_site_tenant). */
export async function visitorSiteTenant(prisma: Client, siteKey: string): Promise<string | null> {
  const row = await scoped({ lookup: { VisitorSettings: { siteKey } } }, () =>
    prisma.visitorSettings.findFirst({ where: { siteKey, enabled: true }, select: { tenantId: true } }),
  );
  return row?.tenantId ?? null;
}

/**
 * Changes the current context inside a `withDbContext` callback (was `set_config('app.user_id', ...)` mid
 * transaction, for example right after sign-up creates the user).
 */
export function updateDbContext(patch: Partial<DbContext>): void {
  const ctx = currentDbContext();
  if (!ctx) throw new Error('updateDbContext called outside withDbContext');
  Object.assign(ctx, patch);
}
