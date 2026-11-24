'use client';

/**
 * Before and after of one audit entry (ADR 0074, C3): a row per changed field, the old value struck through beside
 * the new one. Values are shown as stored, with secrets already removed by the server.
 */

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.length ? v.join(', ') : '—';
  return JSON.stringify(v, null, 1);
}

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Names for fields whose key reads poorly. */
const FIELD_LABEL: Record<string, string> = {
  requireMfa: 'Require two-step verification',
  idleMinutes: 'Idle time (minutes)',
  lockoutAttempts: 'Failed attempts before a pause',
  lockoutMinutes: 'Pause (minutes)',
  planCode: 'Plan',
  currentPeriodEnd: 'Renews on',
  currentPeriodStart: 'Period starts',
  canCreateExecutives: 'Creates Executive Workspaces',
  countryCode: 'Country',
  regionCode: 'State / province',
  addressLine1: 'Address',
  addressLine2: 'Address (line 2)',
  contactName: 'Primary contact',
  contactEmail: 'Contact email',
  contactPhone: 'Contact phone',
};

/** "maxManagerWorkspaces" → "Max manager workspaces". */
export function fieldLabel(key: string): string {
  if (FIELD_LABEL[key]) return FIELD_LABEL[key]!;
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const b = asObject(before);
  const a = asObject(after);
  if (before == null && after == null) return <p className="text-sm text-muted-foreground">This entry records an action, not a change of values.</p>;
  // Plain values (a single setting) get one row.
  const rows: [string, unknown, unknown][] = b || a ? [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].map((k) => [k, b?.[k], a?.[k]]) : [['Value', before, after]];
  return (
    <table className="w-full text-sm" data-diff>
      <caption className="sr-only">Values before and after the change</caption>
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="py-1.5 pe-3 text-start font-medium">Field</th>
          <th scope="col" className="py-1.5 pe-3 text-start font-medium">Before</th>
          <th scope="col" className="py-1.5 text-start font-medium">After</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, from, to]) => {
          const changed = JSON.stringify(from ?? null) !== JSON.stringify(to ?? null);
          return (
            <tr key={k} className="border-t border-border align-top" data-diff-field={k} data-changed={changed ? 'yes' : 'no'}>
              <th scope="row" className="py-2 pe-3 text-start font-medium">{fieldLabel(k)}</th>
              <td className="max-w-[12rem] whitespace-pre-wrap break-words py-2 pe-3 font-mono text-xs">
                {changed ? (
                  <del className="rounded bg-critical/10 px-1 text-foreground decoration-critical/60">{show(from)}</del>
                ) : (
                  show(from)
                )}
              </td>
              <td className="max-w-[12rem] whitespace-pre-wrap break-words py-2 font-mono text-xs">
                {changed ? <ins className="rounded bg-success/15 px-1 text-foreground no-underline">{show(to)}</ins> : show(to)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
