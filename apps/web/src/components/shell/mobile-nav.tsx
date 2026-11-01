'use client';

import type { Permission } from '@dealflow/types';
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@dealflow/ui';
import { Handshake, LayoutDashboard, ListTodo, Plus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { CREATE } from '@/lib/shortcuts';
import { useQuickCreate } from '@/stores/quick-create';

const PERMISSION: Record<string, Permission> = { leads: 'leads:write', contacts: 'contacts:write', companies: 'companies:write', deals: 'deals:write', task: 'activities:write' };

const TABS = [
  { href: '/app', label: 'mobile.home', icon: LayoutDashboard },
  { href: '/app/leads', label: 'mobile.leads', icon: UserPlus },
  null,
  { href: '/app/deals', label: 'mobile.deals', icon: Handshake },
  { href: '/app/activities', label: 'mobile.tasks', icon: ListTodo },
] as const;

/** Bottom navigation on phones and small tablets (the sidebar is hidden below the lg breakpoint). */
export function MobileBottomNav() {
  const pathname = usePathname();
  const { data } = useSession();
  const openCreate = useQuickCreate((s) => s.open);
  const tr = useT();
  return (
    <nav
      aria-label={tr('mobile.nav')}
      data-shell="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((t) =>
          t === null ? (
            <li key="create" className="grid place-items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={tr('mobile.create')} className="-mt-5 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg">
                    <Plus className="size-5" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="center">
                  <DropdownMenuLabel>{tr('mobile.create')}</DropdownMenuLabel>
                  {CREATE.map((c) => (
                    <DropdownMenuItem key={c.kind} disabled={!data?.permissions.includes(PERMISSION[c.kind]!)} onSelect={() => openCreate(c.kind)}>
                      <Plus aria-hidden /> {tr(`create.${c.kind}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ) : (
            <li key={t.href}>
              {(() => {
                const active = t.href === '/app' ? pathname === '/app' : pathname.startsWith(t.href);
                return (
                  <Link
                    href={t.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]', active ? 'font-semibold text-primary' : 'text-muted-foreground')}
                  >
                    <t.icon className="size-5" aria-hidden />
                    {tr(t.label)}
                  </Link>
                );
              })()}
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
