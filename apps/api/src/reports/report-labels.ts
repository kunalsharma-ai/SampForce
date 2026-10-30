import { type DateBucket, type ReportDefinition, type ReportResultRow, reportField } from '@dealflow/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let regionNames: Intl.DisplayNames | null | undefined;

function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function humanizeEnum(v: string): string {
  const s = v.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Label for the start date (YYYY-MM-DD) of a bucket. */
export function bucketLabel(iso: string, bucket: DateBucket): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  switch (bucket) {
    case 'year':
      return String(y);
    case 'quarter':
      return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
    case 'month':
      return `${MONTHS[m - 1]} ${y}`;
    case 'week':
      return `Week of ${iso}`;
    default:
      return iso;
  }
}

/** Human labels for grouped rows. User ids resolve through `users`; anything unknown keeps its key. */
export function labelRows(def: ReportDefinition, rows: { g: string | null; v: number | null }[], users: Map<string, { name: string }>): ReportResultRow[] {
  const field = def.groupBy ? reportField(def.entity, def.groupBy.field) : undefined;
  return rows.map(({ g, v }) => {
    const value = Math.round((v ?? 0) * 100) / 100;
    if (!def.groupBy || !field) return { key: null, label: 'All', value };
    if (g === null) return { key: null, label: field.kind === 'user' ? 'Unassigned' : '(none)', value };
    let label = g;
    switch (field.kind) {
      case 'date':
        label = bucketLabel(g, def.groupBy.bucket ?? 'day');
        break;
      case 'enum':
        label = humanizeEnum(g);
        break;
      case 'boolean':
        label = g === 'true' ? 'Yes' : 'No';
        break;
      case 'country':
        label = countryName(g);
        break;
      case 'user':
        label = users.get(g)?.name ?? 'Former member';
        break;
    }
    return { key: g, label, value };
  });
}
