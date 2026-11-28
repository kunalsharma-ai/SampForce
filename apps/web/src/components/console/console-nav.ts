import type { OperatorPermission } from '@dealflow/types';
import {
  Activity,
  Bell,
  KeyRound,
  Layers,
  Building2,
  CreditCard,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  type LucideIcon,
  MessagesSquare,
  Network,
  PenSquare,
  Plug,
  Receipt,
  Server,
  Settings,
  ShieldCheck,
  Smartphone,
  Ticket,
  UserCog,
  UserPlus,
} from 'lucide-react';

/**
 * The Console sidebar (ADR 0074, regrouped by the control-center plan K1): Command Center, Clients, Workspaces,
 * Integrations, Support, Platform Management and System. Each item is a page that exists today; the pages still to
 * come (Feature Management, Billing, Integration Center, Users, System Health...) join their group as each part
 * ships, never as dead links.
 */

export type ConsoleBadge = 'chat' | 'tickets' | 'notifications';

export interface ConsoleNavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Other paths that belong to this item (old routes, detail pages). */
  also?: string[];
  /** Match only the exact path, not the pages under it. */
  exact?: boolean;
  /** Pages under this one that belong to another menu item. */
  except?: string[];
  badge?: ConsoleBadge;
  children?: ConsoleNavItem[];
  /** Shown only to operators whose role has this permission (ADR 0074); the API refuses the page otherwise. */
  permission?: OperatorPermission;
}

export interface ConsoleNavGroup {
  key: string;
  label: string;
  /** Shown beside the group's title in the menu. */
  icon: LucideIcon;
  items: ConsoleNavItem[];
}

export const CONSOLE_NAV: ConsoleNavGroup[] = [
  {
    key: 'command',
    label: 'Command Center',
    icon: Gauge,
    items: [
      { key: 'overview', label: 'Overview', href: '/operator', icon: LayoutDashboard, exact: true, permission: 'clients.view' },
      { key: 'audit', label: 'Activity & audit log', href: '/operator/audit', icon: Activity, permission: 'audit.view' },
      { key: 'notifications', label: 'Notifications', href: '/operator/notifications', icon: Bell, badge: 'notifications' },
    ],
  },
  {
    key: 'clients',
    label: 'Clients',
    icon: Building2,
    items: [
      {
        key: 'clients',
        label: 'All clients',
        href: '/operator/clients',
        icon: Building2,
        also: ['/operator/tenants'],
        except: ['/operator/clients/new'],
        permission: 'clients.view',
      },
      { key: 'create-client', label: 'Create client', href: '/operator/clients/new', icon: UserPlus, permission: 'clients.edit' },
      { key: 'subscriptions', label: 'Subscriptions & billing', href: '/operator/subscriptions', icon: Receipt, permission: 'clients.view' },
      { key: 'plans', label: 'Plans', href: '/operator/plans', icon: CreditCard, permission: 'clients.view' },
      { key: 'mobile', label: 'Mobile app', href: '/operator/mobile', icon: Smartphone, permission: 'clients.view' },
    ],
  },
  {
    key: 'workspaces',
    label: 'Workspaces',
    icon: Layers,
    items: [
      { key: 'workspaces', label: 'Workspace Management', href: '/operator/workspaces', icon: Layers, permission: 'workspaces.view' },
      { key: 'workspace-rules', label: 'Workspace rules', href: '/operator/workspace-rules', icon: Network, permission: 'workspaces.view' },
    ],
  },
  {
    key: 'integrations',
    label: 'Integrations',
    icon: Plug,
    items: [
      { key: 'providers', label: 'Providers', href: '/operator/providers', icon: Plug, permission: 'system.view' },
    ],
  },
  {
    key: 'support',
    label: 'Support',
    icon: LifeBuoy,
    items: [
      {
        key: 'support',
        label: 'Support',
        href: '/operator/support',
        icon: LifeBuoy,
        children: [
          {
            key: 'tickets',
            label: 'Support tickets',
            href: '/operator/support',
            icon: Ticket,
            badge: 'tickets',
            permission: 'support.handle',
          },
          {
            key: 'chat',
            label: 'Support chat',
            href: '/operator/chat',
            icon: MessagesSquare,
            badge: 'chat',
            permission: 'support.handle',
          },
          {
            key: 'help-manage',
            label: 'Help content',
            href: '/operator/help/manage',
            icon: PenSquare,
          },
        ],
      },
    ],
  },
  {
    key: 'platform',
    label: 'Platform Management',
    icon: UserCog,
    items: [
      { key: 'operators', label: 'Operators', href: '/operator/operators', icon: UserCog, permission: 'operators.manage' },
      { key: 'roles', label: 'Roles & permissions', href: '/operator/roles', icon: KeyRound, permission: 'operators.manage' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    icon: Server,
    items: [
      { key: 'security', label: 'Security', href: '/operator/security', icon: ShieldCheck, permission: 'security.manage' },
      { key: 'settings', label: 'Settings', href: '/operator/settings', icon: Settings, permission: 'system.view' },
      { key: 'locations', label: 'Locations', href: '/operator/locations', icon: MapPin, permission: 'settings.manage' },
      { key: 'help', label: 'Help', href: '/operator/help', icon: HelpCircle, exact: true },
    ],
  },
];

export function navItemActive(item: ConsoleNavItem, path: string): boolean {
  if (item.children) return item.children.some((c) => navItemActive(c, path));
  if (item.except?.some((p) => path === p || path.startsWith(`${p}/`))) return false;
  const paths = [item.href, ...(item.also ?? [])];
  return paths.some((p) => path === p || (!item.exact && path.startsWith(`${p}/`)));
}

/** The menu an operator sees: items their role allows, parents with at least one such child, groups not left empty. */
export function consoleNavFor(permissions: readonly string[] | null | undefined): ConsoleNavGroup[] {
  const allowed = (i: ConsoleNavItem) => !i.permission || !!permissions?.includes(i.permission);
  return CONSOLE_NAV.map((g) => ({
    ...g,
    items: g.items.flatMap((i): ConsoleNavItem[] => {
      if (!i.children) return allowed(i) ? [i] : [];
      const children = i.children.filter(allowed);
      return children.length ? [{ ...i, children }] : [];
    }),
  })).filter((g) => g.items.length > 0);
}

export type ConsolePage = { label: string; href: string; icon: LucideIcon; group: string };

const pagesOf = (nav: ConsoleNavGroup[]): ConsolePage[] =>
  nav.flatMap((g) =>
    g.items.flatMap((i) =>
      i.children
        ? i.children.map((c) => ({ label: c.label, href: c.href, icon: c.icon, group: g.label }))
        : [{ label: i.label, href: i.href, icon: i.icon, group: g.label }],
    ),
  );

/** Every page in the menu, flattened, for breadcrumbs. */
export const CONSOLE_PAGES: ConsolePage[] = pagesOf(CONSOLE_NAV);

/** The pages an operator may open, for the command palette. */
export function consolePagesFor(permissions: readonly string[] | null | undefined): ConsolePage[] {
  return pagesOf(consoleNavFor(permissions));
}

/** Titles for path segments that are not menu items, used by the breadcrumbs. */
const SEGMENT_LABEL: Record<string, string> = { manage: 'Manage', tenants: 'Clients', account: 'Account & security' };

export interface Crumb {
  label: string;
  href: string;
}

/**
 * Breadcrumbs from the path: Console › the menu page › each deeper segment. Ids are shown with the label a page
 * registered for them (the client's name), or "Details" until it loads.
 */
export function crumbsFor(path: string, labels: Record<string, string>): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Console', href: '/operator' }];
  if (path === '/operator') return [...crumbs, { label: 'Overview', href: '/operator' }];
  const parts = path.split('/').filter(Boolean).slice(1);
  let href = '/operator';
  for (const part of parts) {
    href = `${href}/${part}`;
    const page =
      CONSOLE_PAGES.find((p) => p.href === href) ??
      (href === '/operator/tenants'
        ? CONSOLE_PAGES.find((p) => p.href === '/operator/clients')
        : undefined);
    const label =
      labels[href] ??
      labels[part] ??
      page?.label ??
      SEGMENT_LABEL[part] ??
      (/^[0-9a-f-]{20,}$/i.test(part) ? 'Details' : part.charAt(0).toUpperCase() + part.slice(1));
    crumbs.push({ label, href: page?.href ?? href });
  }
  return crumbs;
}
