import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { ENTITY_OF_KEY, entityOfPath, type FieldEntity, hiddenFieldsFor, hiddenKeysByEntity } from '@dealflow/types';
import { from, map, mergeMap, type Observable } from 'rxjs';
import type { AuthedRequest } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { workspaceLevelOf } from './access';
import { workspaceRulesFor } from './workspace-rules';

type Hidden = Partial<Record<FieldEntity, string[]>>;

/** Keys that wrap a list or a page of the same records (a list response, a board column). */
const WRAPPERS = new Set(['items', 'data', 'rows', 'results', 'records', 'list', 'columns', 'cards']);

const blank = (v: unknown): unknown => (Array.isArray(v) ? [] : v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? {} : null);

/**
 * Blanks the hidden fields of every record in a response: the records of the path's own type, and records nested
 * under a key that names a type (`company`, `contacts`, `rfqs`…). Other nested objects (an owner, a status) are left
 * alone, so a person's email under `owner` is not mistaken for a contact's.
 */
export function stripHidden(value: unknown, ctx: FieldEntity | null, hidden: Hidden, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => stripHidden(v, ctx, hidden, depth + 1));
  // Only plain JSON objects: files, streams and buffers pass through untouched.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const keys = ctx ? new Set(hidden[ctx] ?? []) : null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys?.has(k)) {
      out[k] = blank(v);
      continue;
    }
    const next = ENTITY_OF_KEY[k] ?? (WRAPPERS.has(k) ? ctx : null);
    out[k] = next || (v && typeof v === 'object') ? stripHidden(v, next, hidden, depth + 1) : v;
  }
  return out;
}

/** Drops hidden fields from an input, so a form that sends a blanked value back cannot wipe the real one. */
export function dropHidden(body: unknown, entity: FieldEntity, hidden: Hidden): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const b = body as Record<string, unknown>;
  for (const k of hidden[entity] ?? []) delete b[k];
  // Bulk edits carry the changes under `patch` or `changes`.
  for (const inner of ['patch', 'changes', 'fields']) if (b[inner] && typeof b[inner] === 'object') dropHidden(b[inner], entity, hidden);
}

/**
 * Field access for Manager and Executive Workspaces (redesign R8, ADR 0092). The Console decides per level which
 * record fields stay hidden; this hides them on the server, so no screen, export of a page or direct API call shows
 * them, and drops them from what those workspaces send, so they cannot change them either. The Super Workspace and
 * API keys (which act for the organisation) see everything.
 */
@Injectable()
export class FieldAccessInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest & { path?: string; url: string; body?: unknown }>();
    const auth = req.auth;
    const entity = entityOfPath(req.path ?? req.url);
    if (!auth?.workspaceNodeId || !entity) return next.handle();
    const { tenantId } = auth;
    return from(
      this.prisma.run({ tenantId }, async (tx) => {
        const [level, rules] = await Promise.all([workspaceLevelOf(tx, tenantId, auth.membershipId), workspaceRulesFor(tx, tenantId)]);
        return hiddenKeysByEntity(hiddenFieldsFor(level, rules));
      }),
    ).pipe(
      mergeMap((hidden) => {
        if (!Object.keys(hidden).length) return next.handle();
        if (req.method !== 'GET') dropHidden(req.body, entity, hidden);
        return next.handle().pipe(map((data) => stripHidden(data, entity, hidden)));
      }),
    );
  }
}
