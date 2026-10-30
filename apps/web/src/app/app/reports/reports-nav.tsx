'use client';

import { cn } from '@dealflow/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/app/reports', label: 'Reports', match: (p: string) => p === '/app/reports' || p === '/app/reports/new' || /^\/app\/reports\/[0-9a-f-]{36}$/.test(p) },
  { href: '/app/reports/dashboards', label: 'Dashboards', match: (p: string) => p.startsWith('/app/reports/dashboards') },
  { href: '/app/reports/galaxy', label: 'Relationship Galaxy', match: (p: string) => p.startsWith('/app/reports/galaxy') },
  { href: '/app/reports/globe', label: 'Revenue Globe', match: (p: string) => p.startsWith('/app/reports/globe') },
  { href: '/app/reports/flow', label: 'Pipeline flow', match: (p: string) => p.startsWith('/app/reports/flow') },
  { href: '/app/reports/replay', label: 'Pipeline replay', match: (p: string) => p.startsWith('/app/reports/replay') },
];

/** Section navigation for Reports & Analytics: saved reports, dashboards and the visual explorers. */
export function ReportsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Reports and analytics" className="mb-6 overflow-x-auto">
      <ul className="inline-flex min-w-max gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {LINKS.map((l) => {
          const active = l.match(path);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn('block rounded-md px-3 py-1.5 text-sm font-medium transition-colors', active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
