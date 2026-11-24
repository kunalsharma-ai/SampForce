import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request facts the platform audit log stores with each entry (ADR 0074, C3): the browser, the Console session
 * (set by OperatorGuard once it knows it) and how many platform audit entries the request wrote, so a Console write
 * that forgot to record itself is caught (AuditRequiredInterceptor).
 */
export interface AuditRequestContext {
  userAgent: string | null;
  sessionId: string | null;
  platformWrites: number;
}

const store = new AsyncLocalStorage<AuditRequestContext>();

type HeaderRequest = { headers: Record<string, string | string[] | undefined> };

export function auditContextMiddleware(req: HeaderRequest, _res: unknown, next: () => void): void {
  const ua = req.headers['user-agent'];
  store.run({ userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null, sessionId: null, platformWrites: 0 }, next);
}

/** The current request's audit facts, or null outside a request (worker, scripts). */
export function auditContext(): AuditRequestContext | null {
  return store.getStore() ?? null;
}
