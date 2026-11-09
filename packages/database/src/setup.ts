import fs from 'node:fs';
import path from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import plans from './seed/plans.json';

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

export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (const plan of plans as Array<Prisma.PlanCreateInput>) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: {} });
  }
}

/** Runs every set-up step with an unguarded client. */
export async function setupDatabase(prisma: PrismaClient, log?: (line: string) => void): Promise<void> {
  await syncIndexes(prisma, log);
  await seedReferenceData(prisma);
}
