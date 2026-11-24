'use client';

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input } from '@dealflow/ui';
import { CONSOLE_WORKSPACE_STATUS_LABEL, type ConsoleDirectoryWorkspace, type ConsoleWorkspaceStatus } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronDown, Eye, Pencil, Power, PowerOff, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useId, useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';

/*
 * The Console's actions on one workspace (workspace management, sections 18-22), shared by the directory and the
 * workspace page. Every block and delete asks for the operator's own password; the API checks it before anything
 * changes and writes both audit logs. The Console reads in English.
 */

export type WorkspaceActionKind = 'edit' | 'suspend' | 'blacklist' | 'reactivate' | 'delete' | 'restore';

const STATUS_TONE: Record<ConsoleWorkspaceStatus, 'success' | 'warning' | 'critical' | 'neutral' | 'primary'> = {
  ACTIVE: 'success',
  PENDING: 'primary',
  SUSPENDED: 'warning',
  BLACKLISTED: 'critical',
  DELETED: 'neutral',
};

export const LEVEL_LABEL = { SUPER: 'Super Workspace', MANAGER: 'Manager Workspace', EXECUTIVE: 'Executive Workspace' } as const;

export function day(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
}

export function WorkspaceStatusBadge({ row }: { row: Pick<ConsoleDirectoryWorkspace, 'status' | 'statusUntil' | 'level'> }) {
  const until = row.statusUntil ? (row.status === 'DELETED' ? `, erased ${day(row.statusUntil)}` : ` until ${day(row.statusUntil)}`) : '';
  return (
    <Badge tone={STATUS_TONE[row.status]} data-workspace-status={row.status}>
      {row.status === 'DELETED' && row.level === 'SUPER' ? 'Closing' : CONSOLE_WORKSPACE_STATUS_LABEL[row.status]}
      {until}
    </Badge>
  );
}

/** Which actions fit a workspace in its current state. */
export function actionsFor(row: ConsoleDirectoryWorkspace): WorkspaceActionKind[] {
  if (row.status === 'DELETED') return row.restorable ? ['restore'] : [];
  const out: WorkspaceActionKind[] = row.level === 'SUPER' ? [] : ['edit'];
  if (row.status === 'SUSPENDED' || row.status === 'BLACKLISTED') out.push('reactivate');
  else out.push('suspend', 'blacklist');
  out.push('delete');
  return out;
}

const ACTION_LABEL: Record<WorkspaceActionKind, string> = {
  edit: 'Edit',
  suspend: 'Suspend',
  blacklist: 'Blacklist for a while',
  reactivate: 'Reactivate',
  delete: 'Delete',
  restore: 'Restore',
};
const ACTION_ICON = { edit: Pencil, suspend: PowerOff, blacklist: Ban, reactivate: Power, delete: Trash2, restore: RotateCcw } as const;

export function WorkspaceActionsMenu({ row, canManage, onAction, showView = true }: { row: ConsoleDirectoryWorkspace; canManage: boolean; onAction: (kind: WorkspaceActionKind) => void; showView?: boolean }) {
  const kinds = canManage ? actionsFor(row) : [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`Actions for ${row.name}`}>
          Actions
          <ChevronDown className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showView && (
          <DropdownMenuItem asChild>
            <Link href={`/operator/workspaces/${encodeURIComponent(row.id)}`}>
              <Eye aria-hidden />
              View
            </Link>
          </DropdownMenuItem>
        )}
        {kinds.map((k) => {
          const Icon = ACTION_ICON[k];
          return (
            <Fragment key={k}>
              {k === 'delete' && <DropdownMenuSeparator />}
              <DropdownMenuItem className={k === 'delete' ? 'text-critical focus:text-critical' : undefined} onSelect={() => onAction(k)}>
                <Icon aria-hidden />
                {ACTION_LABEL[k]}
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TITLE: Record<WorkspaceActionKind, (r: ConsoleDirectoryWorkspace) => string> = {
  edit: (r) => `Edit ${r.name}`,
  suspend: (r) => (r.level === 'SUPER' ? `Suspend ${r.client}` : `Suspend ${r.name}`),
  blacklist: (r) => `Blacklist ${r.name} for a while`,
  reactivate: (r) => `Reactivate ${r.name}`,
  delete: (r) => (r.level === 'SUPER' ? `Close ${r.client}` : `Delete ${r.name}`),
  restore: (r) => (r.level === 'SUPER' ? `Reopen ${r.client}` : `Restore ${r.name}`),
};

function describe(kind: WorkspaceActionKind, r: ConsoleDirectoryWorkspace): string {
  const below = r.level === 'EXECUTIVE' ? '' : ', and everyone in the workspaces below it,';
  switch (kind) {
    case 'edit':
      return 'Its name, designation and description. The client sees the change at once, and it is written to its audit log.';
    case 'suspend':
      return r.level === 'SUPER'
        ? `Suspends the whole client: nobody at ${r.client} can sign in until you reactivate it. Nothing is deleted.`
        : `Its people${below} cannot work until the Console reactivates it. The client cannot lift a suspension the Console set.`;
    case 'blacklist':
      return r.level === 'SUPER'
        ? `Everyone at ${r.client} is blocked until the day you choose; then the block lifts by itself. You can lift it earlier with Reactivate.`
        : `Its people${below} are blocked until the day you choose; then the block lifts by itself. Only the Console can lift it earlier.`;
    case 'reactivate':
      return 'Lifts the suspension or the blacklist now. Its people can work again on their next request.';
    case 'delete':
      return r.level === 'SUPER'
        ? `Closes ${r.client}: everyone is signed out at once. You can reopen it with everything in it for 30 days; after that its data is erased.`
        : 'Its records and open tasks go to the nearest workspace above with someone in it, the workspaces below it move up, and its people lose access. Nothing in the CRM is erased, and you can restore it.';
    case 'restore':
      return r.level === 'SUPER'
        ? `Reopens ${r.client} with everything in it. Its people can sign in again.`
        : 'Brings it back, active, with the people the delete took out. Records already handed over stay where they went.';
  }
}

/** One action's dialog: the reason, and where needed the end day, the typed name and the operator's password. */
export function WorkspaceActionDialog({ row, kind, onClose, onDone }: { row: ConsoleDirectoryWorkspace; kind: WorkspaceActionKind; onClose: () => void; onDone?: (result: unknown) => void }) {
  const id = useId();
  const qc = useQueryClient();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(row.name);
  const [designation, setDesignation] = useState(row.designation);
  const needsPassword = kind === 'suspend' || kind === 'blacklist' || kind === 'delete';
  const typed = row.level === 'SUPER' ? row.client : row.name;
  const ready =
    reason.trim().length >= 3 &&
    (!needsPassword || password.length > 0) &&
    (kind !== 'blacklist' || until >= tomorrow) &&
    (kind !== 'delete' || confirmName.trim().toLowerCase() === typed.trim().toLowerCase()) &&
    (kind !== 'edit' || name.trim().length >= 2);
  const path = `/operator/workspaces/${encodeURIComponent(row.id)}`;
  const run = useMutation({
    mutationFn: () => {
      switch (kind) {
        case 'edit':
          return api(path, { method: 'PATCH', json: { ...(name.trim() !== row.name ? { name: name.trim() } : {}), ...(designation.trim() !== row.designation ? { designation: designation.trim() } : {}), reason } });
        case 'delete':
          return api(path, { method: 'DELETE', json: { confirmName, reason, password } });
        case 'blacklist':
          return api(`${path}/blacklist`, { method: 'POST', json: { until, reason, password } });
        case 'suspend':
          return api(`${path}/suspend`, { method: 'POST', json: { reason, password } });
        default:
          return api(`${path}/${kind}`, { method: 'POST', json: { reason } });
      }
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['operator', 'workspaces'] });
      await qc.invalidateQueries({ queryKey: ['operator', 'clients'] });
      onDone?.(r);
      onClose();
    },
  });
  const destructive = kind === 'delete' || kind === 'suspend' || kind === 'blacklist';
  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent className="max-w-md p-6" data-workspace-action={kind}>
        <DialogTitle className="text-lg font-semibold">{TITLE[kind](row)}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">{describe(kind, row)}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) run.mutate();
          }}
        >
          {kind === 'edit' && (
            <>
              <Field id={`${id}-name`} label="Name">
                <Input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field id={`${id}-designation`} label="Designation">
                <Input id={`${id}-designation`} value={designation} maxLength={80} onChange={(e) => setDesignation(e.target.value)} />
              </Field>
            </>
          )}
          {kind === 'blacklist' && (
            <Field id={`${id}-until`} label="Blocked until" hint="The block lifts at the start of this day (UTC).">
              <Input id={`${id}-until`} type="date" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} />
            </Field>
          )}
          <Field id={`${id}-reason`} label="Reason" hint="Kept in the client's audit log and the Console's.">
            <Input id={`${id}-reason`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {kind === 'delete' && (
            <Field id={`${id}-confirm`} label={`Type ${typed} to confirm`}>
              <Input id={`${id}-confirm`} value={confirmName} autoComplete="off" onChange={(e) => setConfirmName(e.target.value)} />
            </Field>
          )}
          {needsPassword && (
            <Field id={`${id}-password`} label="Your password" hint="Every block and delete asks for it again.">
              <Input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <ErrorText error={run.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={run.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!ready || run.isPending}>
              {kind === 'delete' && row.level === 'SUPER' ? 'Close company' : kind === 'restore' && row.level === 'SUPER' ? 'Reopen company' : ACTION_LABEL[kind]}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
