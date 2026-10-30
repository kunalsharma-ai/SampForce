import { Injectable } from '@nestjs/common';
import type { SearchHit } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';

interface RawHit {
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

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Searches leads, contacts, companies and deals the caller can read. The ILIKE predicates use the
   * trigram indexes from the core_crm migration; `word_similarity` ranks the matches. Queries run
   * under row-level security and also filter on tenant_id explicitly.
   */
  search(auth: AuthContext, q: string, entities: SearchHit['entity'][], limit = 20): Promise<SearchHit[]> {
    const term = q.trim();
    if (term.length < 2 || entities.length === 0) return Promise.resolve([]);
    const pattern = likePattern(term);
    const per = Math.min(limit, 50);
    return this.prisma.run(auth, async (tx) => {
      const queries: Promise<RawHit[]>[] = [];
      if (entities.includes('lead'))
        queries.push(tx.$queryRaw<RawHit[]>`
          SELECT 'lead' AS entity, id::text, full_name AS title, coalesce(company_name, email) AS subtitle,
                 word_similarity(${term}, coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(company_name,''))::float8 AS score
          FROM leads
          WHERE tenant_id = ${auth.tenantId}::uuid AND deleted_at IS NULL
            AND (coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(company_name,'')) ILIKE ${pattern}
          ORDER BY score DESC, updated_at DESC LIMIT ${per}`);
      if (entities.includes('contact'))
        queries.push(tx.$queryRaw<RawHit[]>`
          SELECT 'contact' AS entity, id::text, trim(first_name || ' ' || coalesce(last_name,'')) AS title, email AS subtitle,
                 word_similarity(${term}, coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,''))::float8 AS score
          FROM contacts
          WHERE tenant_id = ${auth.tenantId}::uuid AND deleted_at IS NULL
            AND (coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,'')) ILIKE ${pattern}
          ORDER BY score DESC, updated_at DESC LIMIT ${per}`);
      if (entities.includes('company'))
        queries.push(tx.$queryRaw<RawHit[]>`
          SELECT 'company' AS entity, id::text, name AS title, domain AS subtitle,
                 word_similarity(${term}, coalesce(name,'') || ' ' || coalesce(domain,''))::float8 AS score
          FROM companies
          WHERE tenant_id = ${auth.tenantId}::uuid AND deleted_at IS NULL
            AND (coalesce(name,'') || ' ' || coalesce(domain,'')) ILIKE ${pattern}
          ORDER BY score DESC, updated_at DESC LIMIT ${per}`);
      if (entities.includes('deal'))
        queries.push(tx.$queryRaw<RawHit[]>`
          SELECT 'deal' AS entity, o.id::text, o.name AS title, s.name AS subtitle,
                 word_similarity(${term}, o.name)::float8 AS score
          FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id
          WHERE o.tenant_id = ${auth.tenantId}::uuid AND o.deleted_at IS NULL AND o.name ILIKE ${pattern}
          ORDER BY score DESC, o.updated_at DESC LIMIT ${per}`);
      const hits = (await Promise.all(queries)).flat();
      return hits
        .map((h) => ({ ...h, score: Math.round(Number(h.score) * 1000) / 1000 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    });
  }
}
