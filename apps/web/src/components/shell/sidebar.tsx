'use client';

import { featureForPath, type NavItem } from '@dealflow/types';
import { Badge, cn, Tooltip, TooltipContent, TooltipTrigger } from '@dealflow/ui';
import { ChevronDown, ChevronsLeft, FileText, Handshake, Lock, type LucideIcon, SlidersHorizontal, UserPlus, X } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFeatures, useSwitchedOff } from '@/lib/features';
import { useNotificationSummary } from '@/lib/notification-center';
import { type MessageKey, useT } from '@/lib/i18n';
import { type ModuleDef, moduleHref, moduleKey, MODULES, phaseLabel } from '@/lib/navigation';
import { orderedModules, useNavigation, useTogglePin } from '@/lib/workspace-nav';
import { usePreferences } from '@/stores/preferences';
import { useShell } from '@/stores/shell';
import { Logo } from '../logo';
import { useChatUnreadTotal } from './chat-button';

const GROUPS: ModuleDef['group'][] = ['Workspace', 'Engage', 'Intelligence', 'Revenue', 'Organization'];
/**
 * Redesign R2 (ADR 0082): the sidebar opens with the daily sales work only (the Workspace group) and Settings. Every
 * other section sits under More, which the person opens and closes; it opens by itself on a page that is inside it.
 */
const PRIMARY_GROUP: ModuleDef['group'] = 'Workspace';
const ALWAYS_SHOWN = new Set(['settings']);

function isActive(pathname: string, href: string): boolean {
  return href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(`${href}/`);
}

/** The icon for a pinned item: its module's icon when it is a module page, else one per record kind. */
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
  const switchedOff = useSwitchedOff();
  const modules = orderedModules(nav).filter((m) => !switchedOff(moduleHref(m)));
  const t = useT();
  const features = useFeatures();
  // Unread notifications per section (ADR 0075), next to the section they come from.
  const bySection = useNotificationSummary(features.ready && features.has('notifications')).data?.bySection;
  // Unread team chat messages, on Team chat (the header no longer has a chat button, redesign R1).
  const chatUnread = useChatUnreadTotal();
  const moreOpenPref = usePreferences((s) => s.navMoreOpen);
  const setMoreOpen = usePreferences((s) => s.setNavMoreOpen);
  const inMore = (m: ModuleDef) => m.group !== PRIMARY_GROUP && !ALWAYS_SHOWN.has(m.slug);
  const moreModules = modules.filter(inMore);
  const hereInMore = moreModules.some((m) => isActive(pathname, moduleHref(m)));
  const moreOpen = moreOpenPref || hereInMore;
  const unreadInMore = bySection ? moreModules.reduce((n, m) => n + ((bySection as Record<string, number | undefined>)[m.slug] ?? 0), 0) : 0;

  const renderGroup = (group: ModuleDef['group'], list: ModuleDef[]) => {
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
                    m.slug === 'chat' && chatUnread !== null && !locked ? (
                      chatUnread === 0 ? (
                        <span className="sr-only" data-chat-unread={0}>
                          {t('Team chat, {n} unread', { n: 0 })}
                        </span>
                      ) : (
                        <span
                          className="relative grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-[hsl(var(--sf-red))] px-1 text-[10px] font-bold text-white tabular"
                          data-chat-unread={chatUnread}
                        >
                          <span aria-hidden>{chatUnread > 99 ? '99+' : chatUnread}</span>
                          <span className="sr-only">{t('Team chat, {n} unread', { n: chatUnread })}</span>
                        </span>
                      )
                    ) : m.status === 'planned' ? (
                      <Badge className="relative px-1.5 py-0 text-[10px]" title={`Planned: ${phaseLabel(m.phase)}`}>
                        {phaseLabel(m.phase, true)}
                      </Badge>
                    ) : !locked && bySection && (bySection as Record<string, number | undefined>)[m.slug] ? (
                      <span
                        className="relative grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-[hsl(var(--sf-red))] px-1 text-[10px] font-bold text-white tabular"
                        data-nav-unread={m.slug}
                        title={t('New in {section}: {n}', { section: t(moduleKey(m) as MessageKey), n: (bySection as Record<string, number>)[m.slug]! })}
                      >
                        <span aria-hidden>{(bySection as Record<string, number>)[m.slug]! > 99 ? '99+' : (bySection as Record<string, number>)[m.slug]}</span>
                        <span className="sr-only">{t('New in {section}: {n}', { section: t(moduleKey(m) as MessageKey), n: (bySection as Record<string, number>)[m.slug]! })}</span>
                      </span>
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
  };

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
      {GROUPS.map((group) => renderGroup(group, modules.filter((m) => m.group === group && !inMore(m))))}
      {moreModules.length > 0 && (
        <section data-nav-section="more" aria-label={t('More')}>
          <button
            type="button"
            onClick={() => setMoreOpen(!moreOpen)}
            aria-expanded={moreOpen}
            aria-controls={`${idPrefix}-more`}
            disabled={hereInMore}
            data-nav-more=""
            title={collapsed ? t('More') : undefined}
            className={cn('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent', collapsed && 'justify-center')}
          >
            <ChevronDown className={cn('size-4 shrink-0 transition-transform', moreOpen && 'rotate-180')} aria-hidden />
            <span className={cn('flex-1 truncate text-start', collapsed && 'sr-only')}>{t('More')}</span>
            {!moreOpen && unreadInMore > 0 && (
              <span className="grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-[hsl(var(--sf-red))] px-1 text-[10px] font-bold text-white tabular" data-nav-more-unread="">
                <span aria-hidden>{unreadInMore > 99 ? '99+' : unreadInMore}</span>
                <span className="sr-only">{t('New in {section}: {n}', { section: t('More'), n: unreadInMore })}</span>
              </span>
            )}
          </button>
          <div id={`${idPrefix}-more`} hidden={!moreOpen} className="mt-3 space-y-5">
            {GROUPS.map((group) => renderGroup(group, moreModules.filter((m) => m.group === group)))}
          </div>
        </section>
      )}
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
          <Logo compact={collapsed} animated />
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
