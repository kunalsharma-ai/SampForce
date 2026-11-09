import { Injectable } from '@nestjs/common';
import type { SearchHit } from '@dealflow/types';
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
  constructor(private readonly prisma: PrismaService) {}

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
      if (entities.includes('lead')) {
        const rows = await tx.lead.findMany({
          where: { ...base, ...wordsWhere(term, ['fullName', 'email', 'companyName']) },
          select: { id: true, fullName: true, email: true, companyName: true },
          orderBy: { updatedAt: 'desc' },
          take,
        });
        hits.push(...rank(rows.map((r) => ({ entity: 'lead' as const, id: r.id, title: r.fullName, subtitle: r.companyName ?? r.email, text: [r.fullName, r.email, r.companyName] })), term, per));
      }
      if (entities.includes('contact')) {
        const rows = await tx.contact.findMany({
          where: { ...base, ...wordsWhere(term, ['firstName', 'lastName', 'email']) },
          select: { id: true, firstName: true, lastName: true, email: true },
          orderBy: { updatedAt: 'desc' },
          take,
        });
        hits.push(...rank(rows.map((r) => ({ entity: 'contact' as const, id: r.id, title: `${r.firstName} ${r.lastName ?? ''}`.trim(), subtitle: r.email, text: [r.firstName, r.lastName, r.email] })), term, per));
      }
      if (entities.includes('company')) {
        const rows = await tx.company.findMany({
          where: { ...base, ...wordsWhere(term, ['name', 'domain']) },
          select: { id: true, name: true, domain: true },
          orderBy: { updatedAt: 'desc' },
          take,
        });
        hits.push(...rank(rows.map((r) => ({ entity: 'company' as const, id: r.id, title: r.name, subtitle: r.domain, text: [r.name, r.domain] })), term, per));
      }
      if (entities.includes('deal')) {
        const rows = await tx.opportunity.findMany({
          where: { ...base, ...wordsWhere(term, ['name']) },
          select: { id: true, name: true, stage: { select: { name: true } } },
          orderBy: { updatedAt: 'desc' },
          take,
        });
        hits.push(...rank(rows.map((r) => ({ entity: 'deal' as const, id: r.id, title: r.name, subtitle: r.stage.name, text: [r.name] })), term, per));
      }
      return hits
        .map((h) => ({ ...h, score: Math.round(h.score * 1000) / 1000 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    });
  }
}

function rank(rows: Array<Omit<Hit, 'score'> & { text: (string | null)[] }>, term: string, per: number): Hit[] {
  return rows
    .map(({ text, ...r }) => ({ ...r, score: wordSimilarity(term, text.filter(Boolean).join(' ')) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, per);
}
