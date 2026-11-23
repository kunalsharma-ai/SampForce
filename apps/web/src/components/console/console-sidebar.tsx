'use client';

import { Badge, cn, Tooltip, TooltipContent, TooltipTrigger } from '@dealflow/ui';
import { ChevronDown, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Logo } from '@/components/logo';
import { type ConsoleBadge, type ConsoleNavItem, consoleNavFor, navItemActive } from './console-nav';

export type BadgeCounts = Partial<Record<ConsoleBadge, number>>;

function CountBadge({ value, tone }: { value: number; tone: 'critical' | 'warning' }) {
  if (value <= 0) return null;
  // The shared badge colours on an opaque base, so the active row's tint never weakens their contrast.
  return (
    <span className="relative rounded-full bg-surface">
      <Badge tone={tone} className="px-1.5 py-0 text-[11px] font-semibold tabular">
        {value > 99 ? '99+' : value}
      </Badge>
    </span>
  );
}

function ItemLink({
  item,
  active,
  collapsed,
  counts,
  nested,
  onNavigate,
}: {
  item: ConsoleNavItem;
  active: boolean;
  collapsed: boolean;
  counts: BadgeCounts;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const count = item.badge ? (counts[item.badge] ?? 0) : 0;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      data-nav-item={item.key}
      {...(item.badge === 'chat'
        ? { 'data-chat-unread': count }
        : item.badge === 'tickets'
          ? { 'data-tickets-waiting': count }
          : {})}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
        active
          ? 'font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
        collapsed && 'justify-center px-0',
        nested && !collapsed && 'ms-4 py-1.5',
      )}
    >
      {active && (
        <motion.span
          layoutId="console-nav-active"
          className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-primary/25"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}
      {active && !collapsed && (
        <span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-primary" aria-hidden />
      )}
      <item.icon
        className={cn('relative size-[18px] shrink-0', active && 'text-primary')}
        aria-hidden
      />
      {collapsed ? (
        <>
          <span className="sr-only">{item.label}</span>
          {count > 0 && (
            <span className="absolute end-1 top-1 size-2 rounded-full bg-critical" aria-hidden />
          )}
        </>
      ) : (
        <>
          <span className="relative flex-1 truncate">{item.label}</span>
          {item.badge && (
            <CountBadge value={count} tone={item.badge === 'chat' ? 'critical' : 'warning'} />
          )}
        </>
      )}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {count > 0 ? ` (${count})` : ''}
      </TooltipContent>
    </Tooltip>
  );
}

function Parent({
  item,
  collapsed,
  counts,
  onNavigate,
}: {
  item: ConsoleNavItem;
  collapsed: boolean;
  counts: BadgeCounts;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const active = navItemActive(item, path);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const children = item.children ?? [];
  // In the icon rail every child is its own icon, so nothing hides behind a closed group.
  if (collapsed)
    return (
      <>
        {children.map((c) => (
          <li key={c.key}>
            <ItemLink
              item={c}
              active={navItemActive(c, path)}
              collapsed
              counts={counts}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </>
    );
  const total = children.reduce((n, c) => n + (c.badge ? (counts[c.badge] ?? 0) : 0), 0);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`console-nav-${item.key}`}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-muted/70',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <item.icon className={cn('size-[18px] shrink-0', active && 'text-primary')} aria-hidden />
        <span className="flex-1 text-start">{item.label}</span>
        {!open && total > 0 && <CountBadge value={total} tone="warning" />}
        <ChevronDown
          className={cn('size-4 transition-transform duration-200', !open && '-rotate-90')}
          aria-hidden
        />
      </button>
      <motion.ul
        id={`console-nav-${item.key}`}
        initial={false}
        animate={{ height: open ? 'auto' : 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-0.5 overflow-hidden"
        hidden={!open}
      >
        {children.map((c) => (
          <li key={c.key}>
            <ItemLink
              item={c}
              active={navItemActive(c, path)}
              collapsed={false}
              counts={counts}
              nested
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </motion.ul>
    </li>
  );
}

/** The Console's left menu (ADR 0074): grouped, collapsible to an icon rail, with live counts. */
export function ConsoleSidebarNav({
  collapsed,
  counts,
  permissions,
  onNavigate,
}: {
  collapsed: boolean;
  counts: BadgeCounts;
  permissions: readonly string[];
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const nav = useMemo(() => consoleNavFor(permissions), [permissions]);
  return (
    <nav aria-label="Operator" className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
      {nav.map((group) => (
        <section key={group.key} aria-labelledby={`console-group-${group.key}`}>
          <h2
            id={`console-group-${group.key}`}
            className={
              collapsed
                ? 'sr-only'
                : 'px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'
            }
          >
            {group.label}
          </h2>
          <ul className="space-y-0.5">
            {group.items.map((item) =>
              item.children ? (
                <Parent
                  key={item.key}
                  item={item}
                  collapsed={collapsed}
                  counts={counts}
                  onNavigate={onNavigate}
                />
              ) : (
                <li key={item.key}>
                  <ItemLink
                    item={item}
                    active={navItemActive(item, path)}
                    collapsed={collapsed}
                    counts={counts}
                    onNavigate={onNavigate}
                  />
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export function ConsoleSidebar({
  collapsed,
  counts,
  permissions,
  onToggle,
}: {
  collapsed: boolean;
  counts: BadgeCounts;
  permissions: readonly string[];
  onToggle: () => void;
}) {
  return (
    <aside
      className={cn(
        'df-glass sticky top-0 hidden h-screen shrink-0 flex-col border-e border-border/70 bg-surface/70 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[72px]' : 'w-[264px]',
      )}
      data-console-sidebar={collapsed ? 'collapsed' : 'open'}
    >
      <div
        className={cn('flex h-16 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}
      >
        <Logo compact />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">SampForce Console</p>
            <p className="text-[11px] text-muted-foreground">Platform control center</p>
          </div>
        )}
      </div>
      <ConsoleSidebarNav collapsed={collapsed} counts={counts} permissions={permissions} />
      <div className="border-t border-border/70 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <ChevronsRight className="size-[18px]" aria-hidden />
          ) : (
            <ChevronsLeft className="size-[18px]" aria-hidden />
          )}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
