import fs from 'node:fs';
import path from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import plans from './seed/plans.json';
import { upgradeCompanyCrm } from './company-crm';
import { upgradeCommandCenter } from './command-center';

/**
 * Database set-up, run on every deploy (`pnpm --filter @dealflow/database db:setup`) and before the test suites.
 * MongoDB has no migrations; this replaces them:
 *
 *  1. Indexes. Every `@unique`, `@@unique` and `@@index` in prisma/schema.prisma becomes a MongoDB index with the
 *     name Prisma would give it. `prisma db push` is not used because it cannot create partial indexes and fails
 *     when it finds one: a unique index on an optional field must be partial, because MongoDB counts a missing or
 *     null value as a value (a plain index would allow only one product without an SKU), whereas PostgreSQL
 *     treated NULLs as distinct. Indexes whose definition changed are rebuilt; indexes the schema no longer has
 *     (with Prisma's `_idx`/`_key` names) are dropped.
 *  2. Reference data. The plan catalogue is inserted when missing. Existing plans are left alone: the platform
 *     admin edits them in the operator console (ADR 0057).
 *
 * Every step is idempotent.
 */

export interface IndexSpec {
  collection: string;
  name: string;
  key: Record<string, 1 | -1>;
  unique: boolean;
  /** Fields that are optional in a unique index: the index only covers documents where they hold a value. */
  partialOn: string[];
  /** An explicit partial filter (indexes that were partial on PostgreSQL). */
  partialFilter?: Record<string, unknown>;
  /** Case-insensitive uniqueness (was a unique index on lower(column)). */
  collation?: { locale: string; strength: number };
}

/**
 * Indexes the PostgreSQL migrations created in SQL because Prisma's schema could not express them. Each keeps its
 * PostgreSQL name.
 */
export const EXTRA_INDEXES: IndexSpec[] = [
  // At most one open offline invoice per workspace.
  { collection: 'invoices', name: 'invoices_one_open_offline', key: { tenant_id: 1 }, unique: true, partialOn: [], partialFilter: { provider: 'OFFLINE', status: 'OPEN' } },
  // A person can be in a running sequence once at a time.
  { collection: 'sequence_enrollments', name: 'sequence_enrollments_live_key', key: { sequence_id: 1, email: 1 }, unique: true, partialOn: [], partialFilter: { status: { $in: ['ACTIVE', 'PAUSED'] } } },
  { collection: 'portal_users', name: 'portal_users_invite_idx', key: { invite_token_hash: 1 }, unique: false, partialOn: [], partialFilter: { invite_token_hash: { $gte: '' } } },
  { collection: 'portal_users', name: 'portal_users_reset_idx', key: { reset_token_hash: 1 }, unique: false, partialOn: [], partialFilter: { reset_token_hash: { $gte: '' } } },
  // Territory names are unique per workspace regardless of case.
  { collection: 'territories', name: 'territories_tenant_id_lower_name_key', key: { tenant_id: 1, name: 1 }, unique: true, partialOn: [], collation: { locale: 'en', strength: 2 } },
];

interface ParsedField {
  name: string;
  dbName: string;
  optional: boolean;
  unique: boolean;
  type: string;
}

export function schemaPath(): string {
  return path.resolve(__dirname, '..', 'prisma', 'schema.prisma');
}

/** Reads index definitions from the Prisma schema (the formatted file `prisma format` writes). */
export function collectionNames(schema = fs.readFileSync(schemaPath(), 'utf8')): string[] {
  return [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => /@@map\("([^"]+)"\)/.exec(m[2]!)?.[1] ?? m[1]!);
}

export function indexSpecs(schema = fs.readFileSync(schemaPath(), 'utf8')): IndexSpec[] {
  const specs: IndexSpec[] = [];
  const enums = new Set([...schema.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]!));
  const typeNames = new Set([...schema.matchAll(/^type (\w+) \{/gm)].map((m) => m[1]!));
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const body = m[2]!;
    const collection = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? m[1]!;
    const fields = new Map<string, ParsedField>();
    for (const raw of body.split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line || line.startsWith('@@')) continue;
      const fm = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!fm) continue;
      const [, name, type, , opt, rest] = fm;
      const scalar = /^(String|Int|BigInt|Float|Boolean|DateTime|Json|Bytes)$/.test(type!) || enums.has(type!) || typeNames.has(type!);
      if (!scalar) continue;
      const isId = /@id\b/.test(rest!);
      const dbName = isId ? '_id' : (/@map\("([^"]+)"\)/.exec(rest!)?.[1] ?? name!);
      fields.set(name!, { name: name!, dbName, optional: !!opt, unique: /@unique\b/.test(rest!), type: type! });
    }
    const make = (names: string[], unique: boolean, map?: string, sorts?: Array<1 | -1>) => {
      const cols = names.map((n) => fields.get(n)?.dbName ?? n);
      const key: Record<string, 1 | -1> = {};
      cols.forEach((c, i) => (key[c] = sorts?.[i] ?? 1));
      const partialOn = unique ? names.filter((n) => fields.get(n)?.optional).map((n) => fields.get(n)!.dbName) : [];
      for (const n of names) {
        const f = fields.get(n);
        // The partial filter below only covers strings; another optional type in a unique index needs its own rule.
        if (unique && f?.optional && f.type !== 'String') throw new Error(`optional ${f.type} ${collection}.${n} in a unique index`);
      }
      specs.push({ collection, name: map ?? `${collection}_${cols.join('_')}_${unique ? 'key' : 'idx'}`, key, unique, partialOn });
    };
    for (const f of fields.values()) if (f.unique) make([f.name], true);
    for (const im of body.matchAll(/@@(index|unique)\(\[([^\]]*)\](?:,\s*map:\s*"([^"]+)")?[^)]*\)/g)) {
      const parts = im[2]!.split(',').map((s) => s.trim()).filter(Boolean);
      const names = parts.map((p) => p.replace(/\(.*\)$/, ''));
      const sorts = parts.map((p) => (/sort:\s*Desc/.test(p) ? -1 : 1) as 1 | -1);
      make(names, im[1] === 'unique', im[3], sorts);
    }
  }
  return specs;
}

type ExistingIndex = { name: string; key: Record<string, number>; unique?: boolean; partialFilterExpression?: unknown; collation?: { locale?: string; strength?: number } };

async function listIndexes(prisma: PrismaClient, collection: string): Promise<ExistingIndex[]> {
  try {
    const res = (await prisma.$runCommandRaw({ listIndexes: collection })) as {
      cursor?: { firstBatch?: ExistingIndex[] };
    };
    return res.cursor?.firstBatch ?? [];
  } catch {
    return []; // the collection does not exist yet
  }
}

function sameIndex(a: ExistingIndex, spec: IndexSpec, partial: Record<string, unknown> | undefined): boolean {
  return (
    JSON.stringify(a.key) === JSON.stringify(spec.key) &&
    !!a.unique === spec.unique &&
    JSON.stringify(a.partialFilterExpression ?? null) === JSON.stringify(partial ?? null) &&
    (spec.collation ? a.collation?.locale === spec.collation.locale && a.collation?.strength === spec.collation.strength : !a.collation || a.collation.locale === 'simple')
  );
}

export async function syncIndexes(prisma: PrismaClient, log: (line: string) => void = () => {}): Promise<void> {
  const specs = [...indexSpecs(), ...EXTRA_INDEXES];
  const byCollection = new Map<string, IndexSpec[]>(collectionNames().map((c) => [c, []]));
  for (const s of specs) byCollection.set(s.collection, [...(byCollection.get(s.collection) ?? []), s]);
  for (const [collection, wanted] of byCollection) {
    const existing = await listIndexes(prisma, collection);
    if (existing.length === 0) await prisma.$runCommandRaw({ create: collection }).catch(() => undefined);
    for (const idx of existing) {
      if (idx.name === '_id_' || wanted.some((w) => w.name === idx.name)) continue;
      if (/_(idx|key)$/.test(idx.name)) {
        await prisma.$runCommandRaw({ dropIndexes: collection, index: idx.name });
        log(`dropped ${collection}.${idx.name}`);
      }
    }
    for (const spec of wanted) {
      const partial =
        spec.partialFilter ??
        // `$gte: ''` matches exactly the string values (BSON compares within a type), so null and missing are left out.
        // `$type` would read the same but Prisma's raw-command reader cannot parse it back from listIndexes.
        (spec.partialOn.length ? Object.fromEntries(spec.partialOn.map((f) => [f, { $gte: '' }])) : undefined);
      const current = existing.find((e) => e.name === spec.name);
      if (current && sameIndex(current, spec, partial)) continue;
      if (current) await prisma.$runCommandRaw({ dropIndexes: collection, index: spec.name });
      await prisma.$runCommandRaw({
        createIndexes: collection,
        indexes: [
          {
            key: spec.key,
            name: spec.name,
            ...(spec.unique ? { unique: true } : {}),
            ...(partial ? { partialFilterExpression: partial } : {}),
            ...(spec.collation ? { collation: spec.collation } : {}),
          },
        ] as unknown as Prisma.InputJsonValue[],
      });
      log(`${current ? 'rebuilt' : 'created'} ${collection}.${spec.name}`);
    }
  }
}

/**
 * Plan features shipped after a workspace's plans were stored, with the plans that include them by default. Each is
 * added to those stored plans once (a counter marks it done), so an operator who later removes it keeps it removed.
 */
export const SHIPPED_FEATURES: { key: string; plans: string[] }[] = [
  // ADR 0060, Phase 3: RFQs are part of the core sales work, so every plan has them unless an operator says otherwise.
  { key: 'rfqs', plans: ['free', 'launch', 'growth', 'professional', 'business', 'enterprise', 'enterprise_plus'] },
  // ADR 0062: advanced custom fields from Growth, Excel export from Launch.
  { key: 'custom_fields_advanced', plans: ['growth', 'professional', 'business', 'enterprise', 'enterprise_plus'] },
  { key: 'excel_export', plans: ['launch', 'growth', 'professional', 'business', 'enterprise', 'enterprise_plus'] },
  // ADR 0063: the role-based Command Center modules, on every plan; the operator console can take any of them away.
  ...['revenue_attribution', 'lead_transfers', 'manager_dashboard', 'senior_dashboard', 'instructions', 'client_concerns'].map((key) => ({
    key,
    plans: ['free', 'launch', 'growth', 'professional', 'business', 'enterprise', 'enterprise_plus'],
  })),
  // ADR 0061: sending RFQs to SampBidx goes with RFQs; an operator can take it off a plan in the console.
  { key: 'sampbidx', plans: ['free', 'launch', 'growth', 'professional', 'business', 'enterprise', 'enterprise_plus'] },
  // ADR 0064: team chat and the support line to super admins come with every plan unless an operator says otherwise.
  { key: 'team_chat', plans: ['free', 'launch', 'growth', 'professional', 'business', 'enterprise', 'enterprise_plus'] },
  // ADR 0072: the mobile app is on every plan, but no organisation gets it until the Console Admin approves it; the
  // console can take it off a plan to sell it with some plans only.
  { key: 'mobile_app', plans: ['free', 'launch', 'growth', 'professional', 'business', 'enterprise', 'enterprise_plus'] },
];

export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (const plan of plans as Array<Prisma.PlanCreateInput>) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: {} });
  }
  for (const f of SHIPPED_FEATURES) {
    const marker = `feature-shipped:${f.key}`;
    if (await prisma.counter.findUnique({ where: { id: marker } })) continue;
    for (const row of await prisma.plan.findMany({ where: { code: { in: f.plans } } })) {
      const ent = (row.entitlements ?? {}) as { features?: unknown };
      const list = Array.isArray(ent.features) ? (ent.features as string[]) : null;
      // A plan without a stored list uses the shipped defaults, which already include the feature.
      if (list && !list.includes(f.key)) await prisma.plan.update({ where: { code: row.code }, data: { entitlements: { ...ent, features: [...list, f.key] } as Prisma.InputJsonValue } });
    }
    await prisma.counter.create({ data: { id: marker, value: 1 } });
  }
}

/**
 * Recently visited pages are no longer kept (2026-11-22). Removes the history stored before then from every
 * workspace member's navigation document. Idempotent: once no document has the field, it changes nothing.
 */
export async function eraseRecentPageHistory(prisma: PrismaClient, log: (line: string) => void = () => {}): Promise<void> {
  const res = (await prisma.$runCommandRaw({
    update: 'workspace_navigation',
    updates: [{ q: { recent: { $exists: true } }, u: { $unset: { recent: '' } }, multi: true }],
  })) as { nModified?: number };
  if (res.nModified) log(`removed recent page history from ${res.nModified} navigation documents`);
}

/**
 * Support query statuses that came before the six-step flow (ADR 0073, 2026-11-22), and what each one became.
 * IN_PROGRESS and CLOSED kept their names.
 */
export const LEGACY_SUPPORT_TICKET_STATUSES: Record<string, string> = { OPEN: 'SUBMITTED', ANSWERED: 'AWAITING_USER' };

/**
 * Moves support queries stored with an old status to the new one. Prisma cannot read a document whose status is no
 * longer in the enum, so without this any list or report that touches an old query fails. Idempotent: once no
 * document has an old status, it changes nothing.
 */
export async function upgradeSupportTicketStatuses(prisma: PrismaClient, log: (line: string) => void = () => {}): Promise<void> {
  const res = (await prisma.$runCommandRaw({
    update: 'support_tickets',
    updates: Object.entries(LEGACY_SUPPORT_TICKET_STATUSES).map(([from, to]) => ({
      q: { status: from },
      u: { $set: { status: to } },
      multi: true,
    })),
  })) as { nModified?: number };
  if (res.nModified) log(`moved ${res.nModified} support queries from old statuses to new ones`);
}

/** The collections Website Visitors (ADR 0029) kept. The feature was removed for Website Enquiry (ADR 0095). */
export const RETIRED_VISITOR_COLLECTIONS = ['web_events', 'web_sessions', 'web_visitors', 'visitor_settings'] as const;

/**
 * Removes what Website Visitors (ADR 0029) left behind once the feature itself is gone (ADR 0095, Kunal 2026-11-27:
 * "remove website visitor completely"). Idempotent; once done it changes nothing.
 *
 *  - Its four collections (anonymous page views, sessions, visitors and the tracking settings) are dropped: no code
 *    reads them any more, and keeping browsing history nobody can see or erase is worse for privacy than deleting it.
 *    Leads and contacts that enquiries created are ordinary CRM records and stay.
 *  - The visitors:read and visitors:manage permissions leave every role. Custom roles get the matching Website
 *    Enquiry permission instead (read stays read, manage becomes write); built-in roles get what their definition
 *    says, as for every new permission.
 *  - Workflows started by "They show high intent on your website" can never run again: they are paused and moved to
 *    the bin (deleted_at), so they disappear from the list but their history stays.
 *  - Unsent high-intent events and the notifications that pointed at the removed page are deleted.
 *  - Plan lists and per-workspace overrides lose the website_visitors feature key, and notification settings the
 *    category of high-intent visitors.
 */
export async function retireWebsiteVisitors(prisma: PrismaClient, log: (line: string) => void = () => {}): Promise<void> {
  const existing = new Set(
    ((await prisma.$runCommandRaw({ listCollections: 1, nameOnly: true })) as { cursor?: { firstBatch?: { name: string }[] } }).cursor?.firstBatch?.map((c) => c.name) ?? [],
  );
  for (const name of RETIRED_VISITOR_COLLECTIONS) {
    if (!existing.has(name)) continue;
    await prisma.$runCommandRaw({ drop: name });
    log(`dropped ${name} (Website Visitors removed)`);
  }
  const run = async (command: Record<string, unknown>): Promise<number> => {
    const res = (await prisma.$runCommandRaw(command as Prisma.InputJsonObject)) as { n?: number; nModified?: number };
    return res.nModified ?? res.n ?? 0;
  };
  const builtIn = await run({
    update: 'roles',
    updates: [
      { q: { is_system: true, key: { $in: ['owner', 'admin', 'manager', 'member', 'viewer'] }, permissions: { $in: ['visitors:read', 'visitors:manage'] } }, u: [{ $set: { permissions: { $setUnion: [{ $setDifference: ['$permissions', ['visitors:read', 'visitors:manage']] }, { $cond: [{ $in: ['$key', ['viewer']] }, ['enquiries:read'], ['enquiries:read', 'enquiries:write']] }] } } }], multi: true },
    ],
  });
  const custom = await run({
    update: 'roles',
    updates: [
      { q: { is_system: { $ne: true }, permissions: 'visitors:manage' }, u: { $addToSet: { permissions: { $each: ['enquiries:read', 'enquiries:write'] } } }, multi: true },
      { q: { is_system: { $ne: true }, permissions: 'visitors:read' }, u: { $addToSet: { permissions: 'enquiries:read' } }, multi: true },
      { q: { permissions: { $in: ['visitors:read', 'visitors:manage'] } }, u: { $pull: { permissions: { $in: ['visitors:read', 'visitors:manage'] } } }, multi: true },
    ],
  });
  if (builtIn + custom) log(`moved ${builtIn + custom} roles from website visitor permissions to website enquiry permissions`);
  const workflows = await run({
    update: 'workflows',
    updates: [{ q: { trigger_type: 'visitor.high_intent', deleted_at: null }, u: { $set: { status: 'PAUSED', deleted_at: { $date: new Date().toISOString() } } }, multi: true }],
  });
  if (workflows) log(`moved ${workflows} high-intent visitor workflows to the bin`);
  const events = await run({ delete: 'domain_events', deletes: [{ q: { type: { $regex: '^visitor\\.' }, processed_at: null }, limit: 0 }] });
  const notices = await run({ delete: 'notifications', deletes: [{ q: { $or: [{ type: { $regex: '^visitor\\.' } }, { link: { $regex: '^/app/website-visitors' } }] }, limit: 0 }] });
  if (events + notices) log(`deleted ${events} pending visitor events and ${notices} visitor notifications`);
  const overrides = await run({ delete: 'tenant_feature_overrides', deletes: [{ q: { feature: 'website_visitors' }, limit: 0 }] });
  const plansChanged = await run({ update: 'plans', updates: [{ q: { 'entitlements.features': 'website_visitors' }, u: { $pull: { 'entitlements.features': 'website_visitors' } }, multi: true }] });
  // A workspace that switched the "High-intent website visitors" notifications off keeps its other choices: the stored
  // list is read with the current category names, so an unknown one would make it fall back to the defaults.
  const settings = await run({ update: 'crm_settings', updates: [{ q: { 'notifications.disabled': 'visitors' }, u: { $pull: { 'notifications.disabled': 'visitors' } }, multi: true }] });
  if (settings) log(`removed the visitors notification category from ${settings} workspaces' settings`);
  if (overrides + plansChanged) log(`removed website_visitors from ${plansChanged} plans and ${overrides} workspace overrides`);
}

/** Workspace apps removed on 2026-11-27: Slack, Microsoft Teams and Zoom. */
export const REMOVED_APPS = { providers: ['SLACK', 'TEAMS', 'ZOOM'], features: ['slack', 'teams', 'zoom'], providerKeys: ['slack', 'zoom'] } as const;
const REMOVED_PROVIDER_SECRETS = ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_WEBHOOK_SECRET_TOKEN'];

interface StoredNode {
  id: string;
  type: string;
  action?: { type?: string };
  next?: string | null;
  onTrue?: string | null;
  onFalse?: string | null;
  onReject?: string | null;
}

/**
 * Takes the "Post to Slack or Teams" steps out of a workflow definition. Every arrow that pointed at a removed step
 * now points at the step after it. A wait left with nothing after it is removed too, since a definition may not end
 * on a wait. Returns null when the definition has no such step. Exported for the tests.
 */
export function withoutChatSteps(def: { start: string | null; nodes: StoredNode[] }): { definition: { start: string | null; nodes: StoredNode[] }; removed: Map<string, string | null> } | null {
  if (!def.nodes.some((n) => n.type === 'action' && n.action?.type === 'post_to_chat')) return null;
  const removed = new Map<string, string | null>();
  let nodes = def.nodes;
  for (;;) {
    const drop = nodes.filter((n) => (n.type === 'action' && n.action?.type === 'post_to_chat') || (n.type === 'delay' && !n.next));
    if (!drop.length) break;
    for (const n of drop) removed.set(n.id, n.next ?? null);
    // Follows chains of removed steps to the first one that stays.
    const resolve = (id: string | null | undefined): string | null => {
      let cur = id ?? null;
      const seen = new Set<string>();
      while (cur && removed.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = removed.get(cur) ?? null;
      }
      return cur;
    };
    nodes = nodes
      .filter((n) => !removed.has(n.id))
      .map((n) => {
        const out = { ...n };
        for (const k of ['next', 'onTrue', 'onFalse', 'onReject'] as const) if (k in out) out[k] = resolve(out[k]);
        return out;
      });
    def = { ...def, start: resolve(def.start), nodes };
  }
  const resolveFinal = (id: string | null): string | null => {
    let cur = id;
    while (cur && removed.has(cur)) cur = removed.get(cur) ?? null;
    return cur;
  };
  for (const [id, next] of removed) removed.set(id, resolveFinal(next));
  return { definition: { ...def, nodes }, removed };
}

/**
 * Clears out what the removed Slack, Teams and Zoom apps left in the database: their connections and send logs, the
 * Zoom meetings collection, their console keys, checks and webhook receipts, their plan features and overrides, and
 * "Post to Slack or Teams" steps in saved workflows (Prisma could not read any of these once the code forgot them).
 * Notes and activities made from Zoom meetings stay. Idempotent: a second run finds nothing to change.
 */
export async function removeChatAndMeetingApps(prisma: PrismaClient, log: (line: string) => void = () => {}): Promise<void> {
  const providers = [...REMOVED_APPS.providers];
  const del = async (collection: string, q: Prisma.InputJsonObject): Promise<number> =>
    ((await prisma.$runCommandRaw({ delete: collection, deletes: [{ q, limit: 0 }] })) as { n?: number }).n ?? 0;

  const events = await del('app_events', { provider: { $in: providers } });
  const connections = await del('app_connections', { provider: { $in: providers } });
  if (events || connections) log(`removed ${connections} Slack, Teams and Zoom connections and ${events} of their events`);

  const existing = (await prisma.$runCommandRaw({ listCollections: 1, filter: { name: 'zoom_meetings' }, nameOnly: true })) as { cursor?: { firstBatch?: unknown[] } };
  if (existing.cursor?.firstBatch?.length) {
    await prisma.$runCommandRaw({ drop: 'zoom_meetings' });
    log('dropped the zoom_meetings collection');
  }

  const secrets = await del('platform_secrets', { _id: { $in: REMOVED_PROVIDER_SECRETS } });
  const settings = await del('platform_settings', {
    _id: { $in: [...REMOVED_APPS.providerKeys.map((k) => `provider_check:${k}`), 'webhook_receipt:zoom', ...REMOVED_PROVIDER_SECRETS.map((k) => `env_import:${k}`)] },
  });
  if (secrets || settings) log(`removed ${secrets} Slack and Zoom provider keys and ${settings} of their console records`);

  const overrides = await del('tenant_feature_overrides', { feature: { $in: [...REMOVED_APPS.features] } });
  if (overrides) log(`removed ${overrides} Slack, Teams and Zoom feature overrides`);
  const plans = (await prisma.$runCommandRaw({
    update: 'plans',
    updates: [{ q: { 'entitlements.features': { $in: [...REMOVED_APPS.features] } }, u: { $pull: { 'entitlements.features': { $in: [...REMOVED_APPS.features] } } }, multi: true }],
  })) as { nModified?: number };
  if (plans.nModified) log(`took Slack, Teams and Zoom out of ${plans.nModified} plans`);

  const versions = (await prisma.workflowVersion.findRaw({ filter: { 'definition.nodes.action.type': 'post_to_chat' } })) as unknown as Array<{ _id: string; definition: { start: string | null; nodes: StoredNode[] } }>;
  for (const v of versions) {
    const out = withoutChatSteps(v.definition);
    if (!out) continue;
    await prisma.workflowVersion.update({ where: { id: v._id }, data: { definition: { ...v.definition, ...out.definition } as unknown as Prisma.InputJsonValue } });
    // A run waiting on a removed step moves on to the step after it.
    for (const [from, to] of out.removed) {
      await prisma.workflowExecution.updateMany({ where: { versionId: v._id, currentNode: from }, data: { currentNode: to } });
    }
  }
  if (versions.length) log(`removed "Post to Slack or Teams" steps from ${versions.length} workflow versions`);
}

/** Runs every set-up step with an unguarded client. */
export async function setupDatabase(prisma: PrismaClient, log?: (line: string) => void): Promise<void> {
  await syncIndexes(prisma, log);
  await seedReferenceData(prisma);
  await upgradeCompanyCrm(prisma, log);
  await upgradeCommandCenter(prisma, log);
  await eraseRecentPageHistory(prisma, log);
  await upgradeSupportTicketStatuses(prisma, log);
  await retireWebsiteVisitors(prisma, log);
  await removeChatAndMeetingApps(prisma, log);
}
