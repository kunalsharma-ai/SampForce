'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@dealflow/ui';
import {
  Bell,
  Bot,
  CalendarDays,
  Check,
  CircleHelp,
  Keyboard,
  ListTodo,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { Permission } from '@dealflow/types';
import { useSession, useSignOut, useSwitchTenant } from '@/lib/session';
import { useCopilot } from '@/stores/copilot';
import { type QuickCreateKind, useQuickCreate } from '@/stores/quick-create';
import { useShell } from '@/stores/shell';
import { Logo } from '../logo';
import { CommandPalette } from './command-palette';
import { FavouriteButton } from './favourite-button';
import { CopilotPanel } from './copilot-panel';
import { VoiceNoteButton } from '../voice/voice-note';
import { NotificationsMenu } from './notifications-menu';
import { ThemeSwitcher } from './theme-switcher';
import { SidebarNav } from './sidebar';

const QUICK_CREATE: { kind: QuickCreateKind; label: string; permission: Permission }[] = [
  { kind: 'leads', label: 'Lead', permission: 'leads:write' },
  { kind: 'contacts', label: 'Contact', permission: 'contacts:write' },
  { kind: 'companies', label: 'Company', permission: 'companies:write' },
  { kind: 'deals', label: 'Deal', permission: 'deals:write' },
  { kind: 'task', label: 'Task', permission: 'activities:write' },
];

function IconLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Bell }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex" data-secondary="">
          <Link href={href} aria-label={label}>
            <Icon aria-hidden />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Topbar() {
  const { data } = useSession();
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
  const [navOpen, setNavOpen] = useState(false);


  const initials = data?.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-border/70 bg-background/70 px-4 backdrop-blur-xl">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
        <Menu aria-hidden />
      </Button>
      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <DialogContent side="left" className="flex flex-col pt-4">
          <DialogTitle className="px-4 pb-4">
            <Logo />
          </DialogTitle>
          <SidebarNav onNavigate={() => setNavOpen(false)} idPrefix="mnav" />
        </DialogContent>
      </Dialog>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex h-control min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface/60 px-3 text-sm text-muted-foreground hover:bg-muted md:max-w-md"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 truncate text-left">Search<span className="hidden sm:inline"> DealFlow</span></span>
        <kbd className="hidden rounded border border-border px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
      </button>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <FavouriteButton />

      <div className="ml-auto flex items-center gap-1">
        <Button variant="outline" size="sm" className="gap-1.5 border-accent/40 hover:bg-accent/10 [&_svg]:text-accent" onClick={() => setCopilotOpen(true)}>
          <Bot aria-hidden />
          <span className="hidden sm:inline">Copilot</span>
        </Button>
        <CopilotPanel open={copilotOpen} onOpenChange={setCopilotOpen} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" aria-label="Quick create" className="hidden lg:inline-flex">
              <Plus aria-hidden />
              <span className="hidden sm:inline">Create</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Quick create</DropdownMenuLabel>
            {QUICK_CREATE.map((item) => (
              <DropdownMenuItem key={item.kind} disabled={!data?.permissions.includes(item.permission)} onSelect={() => openCreate(item.kind)}>
                <Plus aria-hidden /> {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="hidden md:inline-flex" data-secondary="">
          <VoiceNoteButton record={null} variant="ghost" iconOnly label="Quick voice note" />
        </span>

        <NotificationsMenu />
        <span data-secondary="" className="contents">
          <ThemeSwitcher />
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-pressed={focus} aria-label={focus ? 'Exit Focus Workspace' : 'Focus Workspace'} onClick={toggleFocus} className="hidden sm:inline-flex">
              {focus ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{focus ? 'Exit Focus Workspace (Ctrl .)' : 'Focus Workspace (Ctrl .)'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)} className="hidden md:inline-flex" data-secondary="">
              <Keyboard aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
        </Tooltip>

        <IconLink href="/app/activities" label="Tasks" icon={ListTodo} />
        <IconLink href="/app/meetings" label="Calendar" icon={CalendarDays} />
        <IconLink href="/app/integrations" label="Integrations" icon={Plug} />
        <IconLink href="/app/help" label="Help center" icon={CircleHelp} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="ml-1 grid size-9 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-semibold text-background"
            >
              {initials ?? '…'}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {data && (
              <>
                <div className="px-2 py-2">
                  <p className="truncate text-sm font-medium">{data.user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{data.user.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                {data.memberships.map((m) => (
                  <DropdownMenuItem
                    key={m.tenantId}
                    onSelect={() => m.tenantId !== data.tenant.id && void switchTenant(m.tenantId)}
                  >
                    <span className="flex-1 truncate">{m.tenantName}</span>
                    {m.tenantId === data.tenant.id && <Check className="text-primary" aria-label="Current" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <Link href="/app/account/security">
                <ShieldCheck aria-hidden /> Account security
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/settings">
                <Settings aria-hidden /> Settings &amp; appearance
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut aria-hidden /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
