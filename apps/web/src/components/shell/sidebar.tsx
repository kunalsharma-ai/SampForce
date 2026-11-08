'use client';

import { featureForPath, type NavItem } from '@dealflow/types';
import { Badge, cn, Tooltip, TooltipContent, TooltipTrigger } from '@dealflow/ui';
import { ChevronsLeft, Clock, FileText, Handshake, Lock, type LucideIcon, SlidersHorizontal, UserPlus, X } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFeatures } from '@/lib/features';
import { type MessageKey, useT } from '@/lib/i18n';
import { type ModuleDef, moduleHref, moduleKey, MODULES, phaseLabel } from '@/lib/navigation';
import { orderedModules, useNavigation, useTogglePin } from '@/lib/workspace-nav';
import { usePreferences } from '@/stores/preferences';
import { useShell } from '@/stores/shell';
import { Logo } from '../logo';

const GROUPS: ModuleDef['group'][] = ['Workspace', 'Engage', 'Intelligence', 'Revenue', 'Organization'];
const RECENT_SHOWN = 5;

function isActive(pathname: string, href: string): boolean {
  return href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`);
}

/** The icon for a pinned or recent item: its module's icon when it is a module page, else one per record kind. */
function itemIcon(item: NavItem) {
  const mod = MODULES.find((m) => moduleHref(m) === item.href.split('?')[0]);
  if (mod) return mod.icon;
  return { lead: UserPlus, deal: Handshake, contact: UserPlus, company: FileText, quote: FileText, report: FileText, module: FileText, page: FileText }[item.kind];
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  onNavigate,
  badge,
  layoutId,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  badge?: React.ReactNode;
  layoutId?: string;
}) {
  const { dir } = useT();
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        collapsed && 'justify-center',
      )}
    >
      {active && layoutId && (
        <motion.span layoutId={layoutId} className="absolute inset-0 rounded-md bg-primary/10 ring-1 ring-primary/30" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
      )}
      <Icon className={cn('relative size-4 shrink-0', active && 'text-primary')} aria-hidden />
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <>
          <span className="relative flex-1 truncate">{label}</span>
          {badge}
        </>
      )}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side={dir === 'rtl' ? 'left' : 'right'}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Removes a favourite. Shown on hover or keyboard focus. Adding is done from the page itself (top bar star). */
function UnpinButton({ item, onToggle }: { item: NavItem; onToggle: (i: NavItem) => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => onToggle(item)}
      aria-label={t('nav.removeFavourite', { label: item.label })}
      title={t('nav.removeFavouriteShort')}
      className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
    >
      <X className="size-3.5" aria-hidden />
    </button>
  );
}

function GroupHeading({ children, collapsed, id }: { children: React.ReactNode; collapsed: boolean; id: string }) {
  return collapsed ? (
    <h2 id={id} className="sr-only">
      {children}
    </h2>
  ) : (
    <h2 id={id} className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

export function SidebarNav({ collapsed = false, onNavigate, idPrefix = 'nav' }: { collapsed?: boolean; onNavigate?: () => void; idPrefix?: string }) {
  const pathname = usePathname();
  const { nav } = useNavigation();
  const pins = useTogglePin();
  const modules = orderedModules(nav);
  const recent = nav.recent.filter((r) => r.href !== pathname).slice(0, RECENT_SHOWN);
  const t = useT();
  const features = useFeatures();

  return (
    <nav aria-label={t('nav.main')} className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
      {nav.pinned.length > 0 && (
        <section aria-labelledby={`${idPrefix}-fav`} data-nav-section="favourites">
          <GroupHeading collapsed={collapsed} id={`${idPrefix}-fav`}>
            {t('nav.favourites')}
          </GroupHeading>
          <ul className="space-y-0.5">
            {nav.pinned.map((p) => (
              <li key={p.href} className="group/row flex items-center gap-1">
                <NavLink href={p.href} label={p.label} icon={itemIcon(p)} active={pathname === p.href} collapsed={collapsed} onNavigate={onNavigate} />
                {!collapsed && <UnpinButton item={p} onToggle={pins.toggle} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!collapsed && recent.length > 0 && (
        <section aria-labelledby={`${idPrefix}-recent`} data-nav-section="recent">
          <GroupHeading collapsed={collapsed} id={`${idPrefix}-recent`}>
            {t('nav.recent')}
          </GroupHeading>
          <ul className="space-y-0.5">
            {recent.map((r) => (
              <li key={r.href} className="group/row flex items-center gap-1">
                <NavLink href={r.href} label={r.label} icon={Clock} active={false} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {GROUPS.map((group) => {
        const list = modules.filter((m) => m.group === group);
        if (list.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`${idPrefix}-${group}`} data-nav-section="modules">
            <GroupHeading collapsed={collapsed} id={`${idPrefix}-${group}`}>
              {t(`nav.group.${group}`)}
            </GroupHeading>
            <ul className="space-y-0.5">
              {list.map((m) => {
                const href = moduleHref(m);
                const feature = featureForPath(href);
                const locked = !!feature && !features.has(feature);
                return (
                  <li key={m.slug || 'home'} className="group/row flex items-center gap-1">
                    <NavLink
                      href={href}
                      label={t(moduleKey(m) as MessageKey)}
                      icon={m.icon}
                      active={isActive(pathname, href)}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                      layoutId={`${idPrefix}-active`}
                      badge={
                        m.status === 'planned' ? (
                          <Badge className="relative px-1.5 py-0 text-[10px]" title={`Planned: ${phaseLabel(m.phase)}`}>
                            {phaseLabel(m.phase, true)}
                          </Badge>
                        ) : locked ? (
                          <span className="relative text-muted-foreground" title={t('Not in your plan')} data-nav-locked="">
                            <Lock className="size-3.5" aria-hidden />
                            <span className="sr-only">{t('Not in your plan')}</span>
                          </span>
                        ) : null
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const collapsed = usePreferences((s) => s.sidebarCollapsed);
  const toggle = usePreferences((s) => s.toggleSidebar);
  const setCustomizeOpen = useShell((s) => s.setCustomizeOpen);
  const t = useT();
  return (
    <aside
      data-shell="sidebar"
      className={cn(
        'df-sidebar sticky top-0 hidden h-screen shrink-0 flex-col border-e border-border/70 transition-[width] duration-300 lg:flex',
        collapsed ? 'w-[68px]' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center px-4', collapsed && 'justify-center px-0')}>
        <Link href="/app" aria-label={t('nav.home')}>
          <Logo compact={collapsed} />
        </Link>
      </div>
      <SidebarNav collapsed={collapsed} />
      <div className={cn('m-3 flex gap-2', collapsed && 'flex-col')}>
        <button
          type="button"
          onClick={() => setCustomizeOpen(true)}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted"
          aria-label={t('nav.customizeMenu')}
          title={t('nav.customizeMenu')}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {!collapsed && t('nav.customize')}
        </button>
        <button
          type="button"
          onClick={toggle}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted"
          aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          aria-expanded={!collapsed}
          title={t('nav.toggleSidebar')}
        >
          <ChevronsLeft className={cn('size-4 transition-transform rtl:-scale-x-100', collapsed && 'rotate-180')} aria-hidden />
          {!collapsed && t('nav.collapse')}
        </button>
      </div>
    </aside>
  );
}
