'use client';

import { MAX_PINNED, navKindForPath, WORKSPACE_LEVEL_LABEL, type Permission, type WorkspaceLevel } from '@dealflow/types';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dealflow/ui';
import {
  Bot,
  CalendarDays,
  Check,
  Keyboard,
  LifeBuoy,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  Palette,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Sun,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { HelpSupportDialog } from '@/components/help/help-panel';
import { useHasFeature } from '@/lib/features';
import { useHelpSettings } from '@/lib/help-content';
import { type MessageKey, useT } from '@/lib/i18n';
import { moduleHref, moduleKey, MODULES } from '@/lib/navigation';
import { useSession, useSignOut, useSwitchTenant } from '@/lib/session';
import { useWorkspaceHelpReader } from '@/lib/support';
import { useNavigation, useTogglePin } from '@/lib/workspace-nav';
import { useCopilot } from '@/stores/copilot';
import { usePreferences } from '@/stores/preferences';
import { type QuickCreateKind, useQuickCreate } from '@/stores/quick-create';
import { useShell } from '@/stores/shell';
import { StatusControl } from '../availability/status-control';
import { Logo } from '../logo';
import { ChatLive } from './chat-button';
import { CommandPalette } from './command-palette';
import { CopilotPanel } from './copilot-panel';
import { NotificationsMenu } from './notifications-menu';
import { SidebarNav } from './sidebar';
import { WorkspaceIdentityBlock } from './workspace-badge';
import { AccountAvatar, AccountProfileItems } from '../people/account-profile';

const QUICK_CREATE: { kind: QuickCreateKind; permission: Permission }[] = [
  { kind: 'companies', permission: 'companies:write' },
  { kind: 'contacts', permission: 'contacts:write' },
  { kind: 'deals', permission: 'deals:write' },
  { kind: 'task', permission: 'activities:write' },
];

/** Each level's accent in the header, so it is clear at a glance which workspace is open (ADR 0071). */
const LEVEL_DOT: Record<WorkspaceLevel, string> = {
  SUPER: 'bg-[hsl(262_83%_58%)]',
  MANAGER: 'bg-[hsl(199_89%_48%)]',
  EXECUTIVE: 'bg-[hsl(152_69%_40%)]',
};

/** The page the person is on, named as the sidebar names it; the home page is the Dashboard. */
function usePageName(): string {
  const pathname = usePathname();
  const t = useT();
  if (pathname === '/app') return t('Dashboard');
  if (pathname === '/app/team-status' || pathname.startsWith('/app/team-status/')) return t('Team status');
  let best: (typeof MODULES)[number] | null = null;
  for (const m of MODULES) {
    const href = moduleHref(m);
    if (m.slug && (pathname === href || pathname.startsWith(`${href}/`)) && (!best || href.length > moduleHref(best).length)) best = m;
  }
  return best ? t(moduleKey(best) as MessageKey) : t('Dashboard');
}

/**
 * The workspace header (redesign R1): only what people need every few minutes. Left, the page and the workspace;
 * centre, one search for companies, contacts, deals and tasks; right, the working status with check-in, break and
 * check-out, the notification bell and the account menu. Everything else lives in the account menu.
 */
export function Topbar() {
  const { data } = useSession();
  const t = useT();
  const pathname = usePathname();
  const openCreate = useQuickCreate((s) => s.open);
  const signOut = useSignOut();
  const switchTenant = useSwitchTenant();
  const searchOpen = useShell((s) => s.searchOpen);
  const setSearchOpen = useShell((s) => s.setSearchOpen);
  const focus = useShell((s) => s.focus);
  const toggleFocus = useShell((s) => s.toggleFocus);
  const setShortcutsOpen = useShell((s) => s.setShortcutsOpen);
  const copilotOpen = useCopilot((s) => s.open);
  const setCopilotOpen = useCopilot((s) => s.setOpen);
  const hasAi = useHasFeature('ai_assistant');
  const hasNotifications = useHasFeature('notifications');
  const appearance = usePreferences((s) => s.appearance);
  const updateAppearance = usePreferences((s) => s.update);
  const helpSettings = useHelpSettings();
  const helpReader = useWorkspaceHelpReader();
  const helpInMenu = !helpSettings.data || (helpSettings.data.menuVisible && helpSettings.data.helpEnabled);
  const { nav } = useNavigation();
  const pins = useTogglePin();
  const [navOpen, setNavOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const pageName = usePageName();

  const pinned = pins.isPinned(pathname);
  const favouritesFull = !pinned && nav.pinned.length >= MAX_PINNED;
  const dark = appearance.mode === 'dark' || (appearance.mode === 'system' && typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  const level = data?.workspace?.level ?? null;

  return (
    <header
      className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-border/70 bg-background/75 px-3 backdrop-blur-xl sm:gap-3 md:px-6"
      data-header="workspace"
    >
      <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" aria-label={t('top.openNav')} onClick={() => setNavOpen(true)}>
        <Menu aria-hidden />
      </Button>
      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <DialogContent side="left" className="flex flex-col pt-4">
          <DialogTitle className="px-4 pb-4">
            <Logo animated />
          </DialogTitle>
          <SidebarNav onNavigate={() => setNavOpen(false)} idPrefix="mnav" />
        </DialogContent>
      </Dialog>

      {/* Left: the page and the workspace */}
      <div className="flex min-w-0 shrink items-center gap-2.5 md:w-56 md:shrink-0 xl:w-64">
        <Link href="/app" className="shrink-0 lg:hidden" aria-label={t('nav.home')}>
          <Logo compact />
        </Link>
        <div className="hidden min-w-0 flex-col sm:flex" data-header-page="">
          <span className="truncate text-base font-semibold leading-tight tracking-tight">{pageName}</span>
          {level && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs leading-tight text-muted-foreground" data-workspace-level={level}>
              <span className={cn('size-2 shrink-0 rounded-full', LEVEL_DOT[level])} aria-hidden />
              <span className="truncate">{t.maybe(WORKSPACE_LEVEL_LABEL[level])}</span>
            </span>
          )}
        </div>
      </div>

      {/* Centre: one search */}
      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label={t('Search companies, contacts, deals, tasks...')}
          className="group flex h-10 w-full min-w-0 max-w-xl items-center gap-2.5 rounded-full border border-border bg-surface/70 px-4 text-sm text-muted-foreground shadow-sm transition-[box-shadow,border-color] hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-header-search=""
        >
          <Search className="size-4 shrink-0 transition-colors group-hover:text-primary" aria-hidden />
          <span className="hidden min-w-0 flex-1 truncate text-start sm:block">{t('Search companies, contacts, deals, tasks...')}</span>
          <kbd className="ms-auto hidden shrink-0 items-center whitespace-nowrap rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none lg:inline-flex" data-search-shortcut="">Ctrl K</kbd>
        </button>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Right: status, bell, account */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {data && <StatusControl />}
        {hasNotifications && <NotificationsMenu />}
        <ChatLive />
        {hasAi && <CopilotPanel open={copilotOpen} onOpenChange={setCopilotOpen} />}
        <HelpSupportDialog reader={helpReader} open={helpOpen} onOpenChange={setHelpOpen} onShortcuts={() => setShortcutsOpen(true)} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('top.account')}
              className="ms-0.5 grid size-9 shrink-0 place-items-center rounded-full transition-transform hover:scale-105"
            >
              <AccountAvatar />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[80vh] w-72 overflow-y-auto">
            {data && (
              <>
                <AccountProfileItems />
                <DropdownMenuSeparator />
                <WorkspaceIdentityBlock />
                {data.memberships.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{t('top.workspaces')}</DropdownMenuLabel>
                    {data.memberships.map((m) => (
                      <DropdownMenuItem key={m.tenantId} onSelect={() => m.tenantId !== data.tenant.id && void switchTenant(m.tenantId)}>
                        <span className="flex-1 truncate">{m.tenantName}</span>
                        {m.tenantId === data.tenant.id && <Check className="text-primary" aria-label={t('top.current')} />}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t('top.quickCreate')}</DropdownMenuLabel>
                {QUICK_CREATE.filter((q) => data.permissions.includes(q.permission)).map((item) => (
                  <DropdownMenuItem key={item.kind} onSelect={() => openCreate(item.kind)}>
                    <Plus aria-hidden /> {t(`kind.${item.kind}`)}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            {hasAi && (
              <DropdownMenuItem onSelect={() => setCopilotOpen(true)} data-menu-copilot="">
                <Bot aria-hidden /> {t('top.copilot')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={favouritesFull || pins.pending}
              onSelect={() => {
                const heading = document.querySelector('main h1')?.textContent?.trim() || document.title || 'Page';
                pins.toggle({ href: pathname, label: heading.slice(0, 120), kind: navKindForPath(pathname) });
              }}
            >
              <Star className={cn(pinned && 'fill-warning text-warning')} aria-hidden />
              {pinned ? t('Remove this page from favourites') : t('Add this page to favourites')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => updateAppearance({ mode: dark ? 'light' : 'dark' })}>
              {dark ? <Sun aria-hidden /> : <Moon aria-hidden />} {dark ? t('Switch to light mode') : t('Switch to dark mode')}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/settings/appearance">
                <Palette aria-hidden /> {t('Open Theme Studio')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleFocus}>
              {focus ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />} {focus ? t('top.focusExit') : t('top.focus')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
              <Keyboard aria-hidden /> {t('top.shortcuts')}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/meetings">
                <CalendarDays aria-hidden /> {t('top.calendar')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/integrations">
                <Plug aria-hidden /> {t('top.integrations')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {helpInMenu && helpReader && (
              <DropdownMenuItem onSelect={() => setHelpOpen(true)} data-help-support-button="workspace" data-help-menu="">
                <LifeBuoy aria-hidden /> {t('Help & support')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href="/app/help" data-account-help>
                <LifeBuoy aria-hidden /> {t('Help Center')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/account/security">
                <ShieldCheck aria-hidden /> {t('top.security')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/settings">
                <Settings aria-hidden /> {t('top.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut aria-hidden /> {t('top.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
