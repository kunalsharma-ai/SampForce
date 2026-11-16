import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { type CustomFieldEntity, customFieldText, matchKeys, type SearchHit } from '@dealflow/types';
import { CustomFieldsService } from './custom-fields.service';
import { canSeeDetails, companyScope, contactScope, leadScope, visibility } from './visibility';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';

interface Hit {
  entity: SearchHit['entity'];
  id: string;
  title: string;
  subtitle: string | null;
  score: number;
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Trigrams the way PostgreSQL's pg_trgm builds them: lower case, each word padded with two spaces before, one after. */
function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const w = `  ${word} `;
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

/**
 * pg_trgm's word_similarity: how well `term` matches the best run of consecutive words in `text` (1 is a perfect
 * match). Used to rank hits the same way the PostgreSQL version did.
 */
export function wordSimilarity(term: string, text: string): number {
  const t = trigrams(term);
  if (t.size === 0) return 0;
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let best = 0;
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= Math.min(words.length, i + 6); j++) {
      const span = trigrams(words.slice(i, j).join(' '));
      let common = 0;
      for (const g of t) if (span.has(g)) common++;
      const union = t.size + span.size - common;
      best = Math.max(best, union ? common / union : 0);
    }
  }
  return best;
}


/**
 * Every word of the query must appear (case-insensitively) in at least one of the fields, so "ada love" finds Ada
 * Lovelace whether the words sit in one field or two. Matching is literal: regex characters are escaped.
 */
function wordsWhere(term: string, fields: string[]): Record<string, unknown> {
  const words = term.split(/\s+/).filter(Boolean).slice(0, 8);
  return { AND: words.map((w) => ({ OR: fields.map((f) => ({ [f]: { contains: w, mode: 'insensitive' } })) })) };
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fields: CustomFieldsService,
  ) {}

  /**
   * Records whose searchable custom fields (ADR 0062) contain the term, with the field that matched. Only fields the
   * person may see are searched, and only records whose details they may see count.
   */
  private async customFieldHits(tx: TenantTx, auth: AuthContext, entity: CustomFieldEntity, delegate: { findRaw(args: { filter: object; options?: object }): unknown }, term: string, take: number): Promise<Map<string, string>> {
    const paths = await this.fields.searchPaths(tx, auth, entity);
    if (!paths.length) return new Map();
    const re = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rows = (await delegate.findRaw({
      filter: { deleted_at: null, $or: paths.map((p) => ({ [p.path]: { $regex: re, $options: 'i' } })) },
      options: { projection: { _id: 1, custom_fields: 1 }, limit: take },
    })) as unknown as { _id: string; custom_fields?: Record<string, unknown> }[];
    const out = new Map<string, string>();
    for (const r of rows) {
      const p = paths.find((x) => customFieldText('TEXT', r.custom_fields?.[x.key]).toLowerCase().includes(term.toLowerCase()) || (Array.isArray(r.custom_fields?.[x.key]) && (r.custom_fields![x.key] as string[]).some((v) => v.toLowerCase().includes(term.toLowerCase()))));
      if (p) out.set(r._id, `${p.label}: ${customFieldText('MULTISELECT', r.custom_fields?.[p.key])}`.slice(0, 120));
    }
    return out;
  }

  /** Adds custom field matches that the standard fields did not already find, ranked below exact field hits. */
  private async addCustomFieldHits(
    tx: TenantTx,
    auth: AuthContext,
    hits: Hit[],
    entity: Hit['entity'],
    cfEntity: CustomFieldEntity,
    term: string,
    take: number,
    load: (ids: string[]) => Promise<{ id: string; title: string }[]>,
  ): Promise<void> {
    const delegate = { company: tx.company, contact: tx.contact, lead: tx.lead, deal: tx.opportunity, rfq: tx.rfq }[entity] as unknown as FindRaw;
    const found = await this.customFieldHits(tx, auth, cfEntity, delegate, term, take);
    const seen = new Set(hits.filter((h) => h.entity === entity).map((h) => h.id));
    const ids = [...found.keys()].filter((id) => !seen.has(id));
    if (!ids.length) return;
    for (const r of await load(ids)) hits.push({ entity, id: r.id, title: r.title, subtitle: found.get(r.id) ?? null, score: 0.5 });
  }

  /**
   * Searches leads, contacts, companies and deals the caller can read: a case-insensitive substring match on the
   * same fields the PostgreSQL trigram indexes covered, ranked by pg_trgm-style word similarity. Queries run through
   * the workspace guard and also filter on tenantId explicitly.
   */
  search(auth: AuthContext, q: string, entities: SearchHit['entity'][], limit = 20): Promise<SearchHit[]> {
    const term = q.trim();
    if (term.length < 2 || entities.length === 0) return Promise.resolve([]);
    const per = Math.min(limit, 50);
    // Read a few more than shown, then rank: the database cannot order by similarity.
    const take = per * 4;
    return this.prisma.run(auth, async (tx) => {
      const base = { tenantId: auth.tenantId, deletedAt: null };
      const hits: Hit[] = [];
      // Record visibility applies; emails, phones, websites and LinkedIn links also match exactly through match keys.
      const v = await visibility(tx, auth);
      const keys = matchKeys({ emails: [term], phones: [term], websites: [term], linkedin: [term] });
      if (entities.includes('lead')) {
        const rows = await tx.lead.findMany({
          where: { ...base, AND: [leadScope(v), wordsWhere(term, ['fullName', 'email', 'companyName'])] },
          select: { id: true, fullName: true, email: true, companyName: true },
          orderBy: { updatedAt: 'desc' },
          take,
        });
        hits.push(...rank(rows.map((r) => ({ entity: 'lead' as const, id: r.id, title: r.fullName, subtitle: r.companyName ?? r.email, text: [r.fullName, r.email, r.companyName] })), term, per));
        await this.addCustomFieldHits(tx, auth, hits, 'lead', 'LEAD', term, take, async (ids) =>
          (await tx.lead.findMany({ where: { ...base, id: { in: ids }, ...leadScope(v) }, select: { id: true, fullName: true, ownerId: true } })).filter((r) => canSeeDetails(v, r.ownerId)).map((r) => ({ id: r.id, title: r.fullName })),
        );
      }
      if (entities.includes('contact')) {
        const rows = await tx.contact.findMany({
          where: { ...base, AND: [contactScope(v), { OR: [wordsWhere(term, ['firstName', 'lastName', 'email']), ...(keys.length ? [{ matchKeys: { hasSome: keys } }] : [])] }] },
          select: { id: true, firstName: true, lastName: true, email: true, ownerId: true },
          orderBy: { updatedAt: 'desc' },
          take,
        });
        hits.push(...rank(rows.map((r) => ({ entity: 'contact' as const, id: r.id, title: `${r.firstName} ${r.lastName ?? ''}`.trim(), subtitle: canSeeDetails(v, r.ownerId) ? r.email : null, text: [r.firstName, r.lastName, r.email] })), term, per));
        await this.addCustomFieldHits(tx, auth, hits, 'contact', 'CONTACT', term, take, async (ids) =>
          (await tx.contact.findMany({ where: { ...base, id: { in: ids }, ...contactScope(v) }, select: { id: true, firstName: true, lastName: true, ownerId: true } })).filter((r) => canSeeDetails(v, r.ownerId)).map((r) => ({ id: r.id, title: `${r.firstName} ${r.lastName ?? ''}`.trim() })),
        );
      }
      if (entities.includes('company')) {
        const rows = await tx.company.findMany({
          where: {
            ...base,
            AND: [companyScope(v), { OR: [wordsWhere(term, ['name', 'domain']), { leadNumber: term.toUpperCase() }, ...(keys.length ? [{ matchKeys: { hasSome: keys } }] : [])] }],
          },
          select: { id: true, name: true, domain: true, leadNumber: true, ownerId: true },
          orderBy: { updatedAt: 'desc' },
          take,
        });
        hits.push(...rank(rows.map((r) => ({ entity: 'company' as const, id: r.id, title: r.name, subtitle: [r.leadNumber, canSeeDetails(v, r.ownerId) ? r.domain : null].filter(Boolean).join(' · ') || null, text: [r.name, r.domain, r.leadNumber] })), term, per));
        await this.addCustomFieldHits(tx, auth, hits, 'company', 'COMPANY', term, take, async (ids) =>
          (await tx.company.findMany({ where: { ...base, id: { in: ids }, ...companyScope(v) }, select: { id: true, name: true, ownerId: true } })).filter((r) => canSeeDetails(v, r.ownerId)).map((r) => ({ id: r.id, title: r.name })),
        );
      }
      if (entities.includes('deal')) {
        const rows = await tx.opportunity.findMany({
          where: { ...base, ...wordsWhere(term, ['name']) },
          select: { id: true, name: true, stage: { select: { name: true } } },
          orderBy: { updatedAt: 'desc' },
          take,
        });
        hits.push(...rank(rows.map((r) => ({ entity: 'deal' as const, id: r.id, title: r.name, subtitle: r.stage.name, text: [r.name] })), term, per));
        await this.addCustomFieldHits(tx, auth, hits, 'deal', 'OPPORTUNITY', term, take, async (ids) =>
          (await tx.opportunity.findMany({ where: { ...base, id: { in: ids } }, select: { id: true, name: true } })).map((r) => ({ id: r.id, title: r.name })),
        );
      }
      // RFQs by number and project name (ADR 0062), for people who can read companies, within company visibility.
      if (entities.includes('company')) {
        const companyIds = v.all ? null : (await tx.company.findMany({ where: { ...base, ...companyScope(v) }, select: { id: true }, take: 10_000 })).map((c) => c.id);
        const rows = await tx.rfq.findMany({
          where: { ...base, ...(companyIds ? { companyId: { in: companyIds } } : {}), OR: [{ number: { contains: term, mode: 'insensitive' } }, wordsWhere(term, ['projectName'])] },
          select: { id: true, number: true, projectName: true, company: { select: { name: true } } },
          orderBy: { updatedAt: 'desc' },
          take,
        });
        hits.push(...rank(rows.map((r) => ({ entity: 'rfq' as const, id: r.id, title: `${r.number} ${r.projectName}`, subtitle: r.company.name, text: [r.number, r.projectName] })), term, per));
        await this.addCustomFieldHits(tx, auth, hits, 'rfq', 'RFQ', term, take, async (ids) =>
          (await tx.rfq.findMany({ where: { ...base, id: { in: ids }, ...(companyIds ? { companyId: { in: companyIds } } : {}) }, select: { id: true, number: true, projectName: true } })).map((r) => ({ id: r.id, title: `${r.number} ${r.projectName}` })),
        );
      }
      return hits
        .map((h) => ({ ...h, score: Math.round(h.score * 1000) / 1000 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    });
  }
}

type FindRaw = { findRaw(args: { filter: object; options?: object }): unknown };

function rank(rows: Array<Omit<Hit, 'score'> & { text: (string | null)[] }>, term: string, per: number): Hit[] {
  return rows
    .map(({ text, ...r }) => ({ ...r, score: wordSimilarity(term, text.filter(Boolean).join(' ')) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, per);
}
