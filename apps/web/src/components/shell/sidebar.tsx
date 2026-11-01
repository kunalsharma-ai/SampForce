'use client';

import { Badge, cn, Tooltip, TooltipContent, TooltipTrigger } from '@dealflow/ui';
import { ChevronsLeft } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ModuleDef, moduleHref, MODULES, phaseLabel } from '@/lib/navigation';
import { usePreferences } from '@/stores/preferences';
import { Logo } from '../logo';

const GROUPS: ModuleDef['group'][] = ['Workspace', 'Engage', 'Intelligence', 'Revenue', 'Organization'];

function isActive(pathname: string, m: ModuleDef): boolean {
  const href = moduleHref(m);
  return href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
      {GROUPS.map((group) => (
        <div key={group}>
          {!collapsed && (
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
          )}
          <ul className="space-y-0.5">
            {MODULES.filter((m) => m.group === group).map((m) => {
              const active = isActive(pathname, m);
              const link = (
                <Link
                  href={moduleHref(m)}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors',
                    active ? 'text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    collapsed && 'justify-center',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-md bg-primary/10 ring-1 ring-primary/30"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  )}
                  <m.icon className={cn('relative size-4 shrink-0', active && 'text-primary')} aria-hidden />
                  {collapsed ? (
                    <span className="sr-only">{m.label}</span>
                  ) : (
                    <>
                      <span className="relative flex-1 truncate">{m.label}</span>
                      {m.status === 'planned' && (
                        <Badge className="relative px-1.5 py-0 text-[10px]" title={`Planned: ${phaseLabel(m.phase)}`}>
                          {phaseLabel(m.phase, true)}
                        </Badge>
                      )}
                    </>
                  )}
                </Link>
              );
              return (
                <li key={m.slug || 'home'}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{m.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const collapsed = usePreferences((s) => s.sidebarCollapsed);
  const toggle = usePreferences((s) => s.toggleSidebar);
  return (
    <aside
      className={cn(
        'df-sidebar sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border/70 transition-[width] duration-300 lg:flex',
        collapsed ? 'w-[68px]' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center px-4', collapsed && 'justify-center px-0')}>
        <Link href="/app" aria-label="DealFlow Command Center">
          <Logo compact={collapsed} />
        </Link>
      </div>
      <SidebarNav collapsed={collapsed} />
      <button
        type="button"
        onClick={toggle}
        className="m-3 flex items-center justify-center gap-2 rounded-md border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
      >
        <ChevronsLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} aria-hidden />
        {!collapsed && 'Collapse'}
      </button>
    </aside>
  );
}
