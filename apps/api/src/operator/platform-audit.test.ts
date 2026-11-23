import { of, lastValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { auditContextMiddleware, auditContext } from '../common/audit-context';
import { AuditRequiredInterceptor } from './audit-required.interceptor';
import { cell } from './console-audit.service';
import { changedFields, redact, REMOVED, targetOf, writePlatformAudit } from './platform-audit';

describe('platform audit entries (ADR 0074, C3)', () => {
  it('removes secrets at any depth and keeps fingerprints', () => {
    expect(redact({ password: 'x', nested: { apiKey: 'k', tokenHash: 'h', fingerprint: 'abc123', ok: 1 }, list: [{ mfaSecretEnc: 's' }], clientSecret: null })).toEqual({
      password: REMOVED,
      nested: { apiKey: REMOVED, tokenHash: REMOVED, fingerprint: 'abc123', ok: 1 },
      list: [{ mfaSecretEnc: REMOVED }],
      clientSecret: null,
    });
    expect(redact(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
  });

  it('works out what an entry is about', () => {
    expect(targetOf({ operatorId: 'a', action: 'operator.role_changed', metadata: { operatorId: 'b', email: 'b@x' } })).toEqual({ type: 'operator', id: 'b', label: 'b@x' });
    expect(targetOf({ operatorId: 'a', action: 'operator_role.updated', metadata: { roleId: 'r', name: 'Billing' } })).toEqual({ type: 'role', id: 'r', label: 'Billing' });
    expect(targetOf({ operatorId: 'a', action: 'support_ticket.answered', tenantId: 't', metadata: { ticketId: 'k' } })).toMatchObject({ type: 'ticket', id: 'k' });
    expect(targetOf({ operatorId: 'a', action: 'client.renewed', tenantId: 't' })).toEqual({ type: 'client', id: 't', label: null });
    expect(targetOf({ operatorId: 'a', action: 'console.security_policy_changed' })).toMatchObject({ type: 'setting' });
  });

  it('keeps only the fields that changed', () => {
    expect(changedFields({ seats: 5, plan: 'growth', note: null }, { seats: 8, plan: 'growth', note: undefined })).toEqual({ before: { seats: 5 }, after: { seats: 8 } });
  });

  it('stores the session and browser of the request, and counts the write', async () => {
    const created: unknown[] = [];
    const db = { platformAuditLog: { create: async (args: { data: unknown }) => created.push(args.data) } };
    await new Promise<void>((done) =>
      auditContextMiddleware({ headers: { 'user-agent': 'Test browser' } }, null, () => {
        auditContext()!.sessionId = 'sess-1';
        void writePlatformAudit(db, { operatorId: 'op', action: 'role.x', metadata: { from: { a: 1 }, to: { a: 2 }, secret: 'no' } }).then(() => {
          expect(auditContext()!.platformWrites).toBe(1);
          done();
        });
      }),
    );
    expect(created[0]).toMatchObject({ sessionId: 'sess-1', userAgent: 'Test browser', before: { a: 1 }, after: { a: 2 }, metadata: { secret: REMOVED } });
  });

  it('refuses a Console write that wrote no audit entry, unless the route says it changes nothing', async () => {
    const reflector = { getAllAndOverride: (_k: string, t: unknown[]) => (t[0] as { noAudit?: boolean }).noAudit === true };
    const interceptor = new AuditRequiredInterceptor(reflector as never);
    const ctx = (method: string, noAudit = false) =>
      ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method, operator: {}, route: { path: '/x' } }) }), getHandler: () => ({ noAudit }), getClass: () => ({}) }) as never;
    const run = (c: never) => new Promise((resolve, reject) => auditContextMiddleware({ headers: {} }, null, () => void lastValueFrom(interceptor.intercept(c, { handle: () => of('ok') })).then(resolve, reject)));
    await expect(run(ctx('POST'))).rejects.toMatchObject({ response: { code: 'UNAUDITED_WRITE' } });
    await expect(run(ctx('POST', true))).resolves.toBe('ok');
    await expect(run(ctx('GET'))).resolves.toBe('ok');
  });

  it('writes CSV cells that a spreadsheet will not run as formulas', () => {
    expect(cell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(cell({ a: 1 })).toBe('"{""a"":1}"');
    expect(cell(null)).toBe('""');
  });
});
