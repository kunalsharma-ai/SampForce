'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dealflow/ui';
import type { OperatorMe, OperatorPermission } from '@dealflow/types';
import { Activity, CreditCard, type LucideIcon, Plus, Ticket, UserCog, UserPlus } from 'lucide-react';
import Link from 'next/link';

interface QuickAction {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  permission: OperatorPermission;
}

const ACTIONS: QuickAction[] = [
  { key: 'client', label: 'Create client', href: '/operator/clients/new', icon: UserPlus, permission: 'clients.edit' },
  { key: 'plan', label: 'Manage plans', href: '/operator/plans', icon: CreditCard, permission: 'plans.manage' },
  { key: 'operator', label: 'Add an operator', href: '/operator/operators', icon: UserCog, permission: 'operators.manage' },
  { key: 'tickets', label: 'Open support tickets', href: '/operator/support', icon: Ticket, permission: 'support.handle' },
  { key: 'audit', label: 'Activity & audit log', href: '/operator/audit', icon: Activity, permission: 'audit.view' },
];

/** The header's quick actions (control-center K1): only what the operator's role allows, each a page that exists. */
export function QuickActions({ me }: { me: Pick<OperatorMe, 'permissions'> }) {
  const actions = ACTIONS.filter((a) => me.permissions.includes(a.permission));
  if (!actions.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-9 gap-1.5 shadow-sm shadow-primary/20" data-quick-actions>
          <Plus className="size-4" aria-hidden />
          <span className="hidden sm:inline">Quick actions</span>
          <span className="sr-only sm:hidden">Quick actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Quick actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {actions.map((a) => (
          <DropdownMenuItem key={a.key} asChild>
            <Link href={a.href} data-quick-action={a.key}>
              <a.icon aria-hidden /> {a.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
