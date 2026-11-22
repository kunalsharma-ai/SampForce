'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import {
  type ActionGrants,
  type CreateWorkspaceInput,
  FEATURE_BY_KEY,
  FEATURE_GROUPS,
  type FeatureGroup,
  type FeatureKey,
  FEATURES,
  WORKSPACE_ACTION_LABEL,
  WORKSPACE_ACTIONS,
  WORKSPACE_LEVEL_LABEL,
  type WorkspaceAction,
  type WorkspacePermissionsInput,
  type WorkspaceRow,
  type WorkspaceTree,
} from '@dealflow/types';
import { Copy, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { useMembers } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useWorkspaceMutations, useWorkspaceTree } from '@/lib/workspaces';

type Creating = 'MANAGER' | 'EXECUTIVE';

/**
 * Workspaces and the Permission Center (ADR 0071, part 3). The Super Workspace manages every workspace; a Manager
 * Workspace manages its own Executive Workspaces. Every rule is enforced by the API; this page only offers what it allows.
 */
export function WorkspacesManager() {
  const t = useT();
  const tree = useWorkspaceTree();
  const { archive } = useWorkspaceMutations();
  const [creating, setCreating] = useState<Creating | null>(null);
  const [permissionsOf, setPermissionsOf] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  if (tree.isPending) return <Skeleton className="h-64" />;
  if (tree.error) return <ErrorText error={tree.error} />;
  const data = tree.data;
  const byId = new Map(data.workspaces.map((w) => [w.id, w]));
  const parentOf = (w: WorkspaceRow) => (w.parentId ? byId.get(w.parentId) : undefined);
  const selected = permissionsOf ? byId.get(permissionsOf) : undefined;
  const edited = editing ? byId.get(editing) : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{data.organization.name}</CardTitle>
            <CardDescription>
              {t('You are in the {level} as {designation}.', { level: t.maybe(WORKSPACE_LEVEL_LABEL[data.mine.level]), designation: t.maybe(data.mine.designation) })}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.canCreate.managers && (
              <Button size="sm" onClick={() => setCreating('MANAGER')}>
                <Plus className="size-4" aria-hidden />
                {t('New Manager Workspace')}
              </Button>
            )}
            {data.canCreate.executives && (
              <Button size="sm" variant={data.canCreate.managers ? 'outline' : 'default'} onClick={() => setCreating('EXECUTIVE')}>
                <Plus className="size-4" aria-hidden />
                {t('New Executive Workspace')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Meter label={t('Manager Workspaces')} used={data.usage.managers.used} max={data.usage.managers.max} />
          <Meter label={t('Executive Workspaces')} used={data.usage.executives.used} max={data.usage.executives.max} />
          {!data.canCreate.managers && !data.canCreate.executives && data.mine.level !== 'EXECUTIVE' && (
            <p className="text-sm text-muted-foreground sm:col-span-2">{t('You cannot create workspaces right now: the limit is reached, or the workspace above yours has not allowed it.')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Workspace structure')}</CardTitle>
          <CardDescription>{t('Who reports to whom. Open Permissions on a workspace below yours to choose what it may use and do.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2" aria-label={t('Workspace structure')} data-workspace-tree>
            {roots(data).map((w) => (
              <Branch key={w.id} row={w} tree={data} depth={0} onPermissions={setPermissionsOf} onEdit={setEditing} onArchive={(r) => {
                if (window.confirm(t('Archive {name}? Its pending invitations are withdrawn and it stops counting towards your limit.', { name: r.name }))) archive.mutate(r.id);
              }} />
            ))}
          </ul>
          <ErrorText error={archive.error} />
        </CardContent>
      </Card>

      {creating && <CreateDialog level={creating} tree={data} onClose={() => setCreating(null)} />}
      {selected && <PermissionCenter row={selected} parent={parentOf(selected) ?? data.mine} callerLevel={data.mine.level} onClose={() => setPermissionsOf(null)} />}
      {edited && <EditDialog row={edited} tree={data} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Top of the visible tree: the caller's own workspace and anything whose parent the caller cannot see. */
function roots(tree: WorkspaceTree): WorkspaceRow[] {
  const ids = new Set(tree.workspaces.map((w) => w.id));
  return tree.workspaces.filter((w) => !w.parentId || !ids.has(w.parentId));
}

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const t = useT();
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="tabular" data-usage={label}>
          {max === null ? t('{used} used, no limit', { used }) : t('{used} of {max} used', { used, max })}
        </span>
      </div>
      {max !== null && (
        <div className="mt-1 h-1.5 rounded-full bg-muted" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
          <div className={`h-full rounded-full ${used >= max ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function Branch({ row, tree, depth, onPermissions, onEdit, onArchive }: { row: WorkspaceRow; tree: WorkspaceTree; depth: number; onPermissions: (id: string) => void; onEdit: (id: string) => void; onArchive: (row: WorkspaceRow) => void }) {
  const t = useT();
  const children = tree.workspaces.filter((w) => w.parentId === row.id).sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level === 'MANAGER' ? -1 : 1));
  const mine = row.id === tree.mine.id;
  return (
    <li>
      <div className="flex flex-wrap items-start gap-3 rounded-md border border-border p-3" style={{ marginInlineStart: `${depth * 1.5}rem` }} data-workspace={row.name}>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {row.name}
            <Badge tone={row.level === 'SUPER' ? 'accent' : row.level === 'MANAGER' ? 'primary' : 'neutral'}>{t.maybe(WORKSPACE_LEVEL_LABEL[row.level])}</Badge>
            {mine && <Badge tone="success">{t('Yours')}</Badge>}
          </p>
          <p className="text-sm text-muted-foreground">{t.maybe(row.designation)}</p>
          <p className="text-xs text-muted-foreground">
            {row.people.length ? row.people.map((p) => p.name).join(', ') : row.pendingInvites.length ? t('Invited: {emails}', { emails: row.pendingInvites.join(', ') }) : t('Nobody in it yet')}
            {' · '}
            {t('Features: {count}', { count: row.features.length })}
            {row.restrictedFeatures.length > 0 && <> · {t('Not given: {count}', { count: row.restrictedFeatures.length })}</>}
          </p>
        </div>
        {row.editable && (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => onPermissions(row.id)}>
              <KeyRound className="size-4" aria-hidden />
              {t('Permissions')}
              <span className="sr-only"> {row.name}</span>
            </Button>
            <Button size="icon" variant="ghost" aria-label={t('Edit {name}', { name: row.name })} onClick={() => onEdit(row.id)}>
              <Pencil aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t('Archive {name}', { name: row.name })} disabled={children.length > 0 || row.people.length > 0} title={children.length || row.people.length ? t('Move its people and workspaces out first') : undefined} onClick={() => onArchive(row)}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        )}
      </div>
      {children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {children.map((c) => (
            <Branch key={c.id} row={c} tree={tree} depth={depth + 1} onPermissions={onPermissions} onEdit={onEdit} onArchive={onArchive} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ───────────── Permission Center ─────────────

/** Features of the catalogue the parent has, by module: each top-level feature followed by its subfeatures. */
function grantable(parent: readonly FeatureKey[]): { group: FeatureGroup; items: { key: FeatureKey; sub: boolean }[] }[] {
  const has = new Set(parent);
  return FEATURE_GROUPS.map((group) => {
    const items: { key: FeatureKey; sub: boolean }[] = [];
    for (const f of FEATURES) {
      if (f.group !== group || f.parent || !has.has(f.key)) continue;
      items.push({ key: f.key, sub: false });
      for (const s of FEATURES) if (s.parent === f.key && has.has(s.key)) items.push({ key: s.key, sub: true });
    }
    // A subfeature whose feature sits in another module still belongs here.
    for (const f of FEATURES) if (f.group === group && f.parent && has.has(f.key) && FEATURE_BY_KEY[f.parent].group !== group) items.push({ key: f.key, sub: true });
    return { group, items };
  }).filter((g) => g.items.length > 0);
}

function PermissionCenter({ row, parent, callerLevel, onClose }: { row: WorkspaceRow; parent: WorkspaceRow; callerLevel: WorkspaceRow['level']; onClose: () => void }) {
  const t = useT();
  const { permissions } = useWorkspaceMutations();
  const groups = useMemo(() => grantable(parent.features), [parent.features]);
  const [features, setFeatures] = useState(() => new Set(row.features));
  const [actions, setActions] = useState<ActionGrants>(() => ({ ...row.actions }));
  const [canCreateExecutives, setCanCreateExecutives] = useState(row.canCreateExecutives);
  const [canViewOtherManagers, setCanViewOtherManagers] = useState(row.canViewOtherManagers);
  const [canChatWithPeers, setCanChatWithPeers] = useState(row.canChatWithPeers);
  const [canViewAuditLog, setCanViewAuditLog] = useState(row.canViewAuditLog);
  const [saved, setSaved] = useState(false);
  const modules = FEATURE_GROUPS.filter((g) => (parent.actions[g] ?? []).length > 0);
  const managerSettings = row.level === 'MANAGER' && callerLevel === 'SUPER';

  const toggleFeature = (key: FeatureKey, on: boolean) => {
    setSaved(false);
    setFeatures((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(key);
        const up = FEATURE_BY_KEY[key].parent;
        if (up && parent.features.includes(up)) next.add(up);
      } else {
        next.delete(key);
        for (const f of FEATURES) if (f.parent === key) next.delete(f.key);
      }
      return next;
    });
  };
  const toggleAction = (group: FeatureGroup, action: WorkspaceAction, on: boolean) => {
    setSaved(false);
    setActions((prev) => {
      const list = new Set(prev[group] ?? []);
      if (on) list.add(action);
      else list.delete(action);
      return { ...prev, [group]: WORKSPACE_ACTIONS.filter((a) => list.has(a)) };
    });
  };
  const setGroup = (group: FeatureGroup, on: boolean) => {
    setSaved(false);
    setFeatures((prev) => {
      const next = new Set(prev);
      for (const i of groups.find((g) => g.group === group)?.items ?? []) {
        if (on) next.add(i.key);
        else next.delete(i.key);
      }
      return next;
    });
  };

  const save = () => {
    const input: WorkspacePermissionsInput = {
      features: FEATURES.map((f) => f.key).filter((k) => features.has(k) && parent.features.includes(k)),
      // Only what the parent has can be handed down; anything else would be refused.
      actions: Object.fromEntries(Object.entries(actions).map(([k, list]) => [k, (list ?? []).filter((a) => (parent.actions[k] ?? parent.actions[FEATURE_BY_KEY[k as FeatureKey]?.group ?? ''] ?? []).includes(a))])),
      ...(managerSettings ? { canCreateExecutives, canViewOtherManagers, canViewAuditLog } : {}),
      ...(row.level !== 'SUPER' ? { canChatWithPeers } : {}),
    };
    permissions.mutate({ id: row.id, input }, { onSuccess: () => setSaved(true) });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Permissions for {name}', { name: row.name })}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('Choose what {name} may use and do. You can only hand down what {parent} has. Records it created stay; a feature you take away becomes unavailable to it at once.', { name: row.name, parent: parent.name })}
        </DialogDescription>
        <form
          className="mt-4 space-y-6"
          data-permission-center
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <section aria-labelledby="pc-features" className="space-y-3">
            <h3 id="pc-features" className="text-sm font-semibold">
              {t('Features')} <span className="font-normal text-muted-foreground">{t('{on} of {all} on', { on: [...features].filter((f) => parent.features.includes(f)).length, all: parent.features.length })}</span>
            </h3>
            {groups.map(({ group, items }) => {
              const on = items.filter((i) => features.has(i.key)).length;
              return (
                <fieldset key={group} className="rounded-md border border-border p-3" data-module={group}>
                  <legend className="flex w-full flex-wrap items-center gap-2 px-1 text-sm font-medium">
                    {t.maybe(group)}
                    <span className="text-xs font-normal text-muted-foreground">{t('{on} of {all} on', { on, all: items.length })}</span>
                  </legend>
                  <div className="mb-2 flex gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setGroup(group, true)} disabled={on === items.length}>
                      {t('Turn all on')}
                      <span className="sr-only"> {t.maybe(group)}</span>
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setGroup(group, false)} disabled={on === 0}>
                      {t('Turn all off')}
                      <span className="sr-only"> {t.maybe(group)}</span>
                    </Button>
                  </div>
                  <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {items.map(({ key, sub }) => {
                      const def = FEATURE_BY_KEY[key];
                      const blocked = sub && !!def.parent && !features.has(def.parent);
                      return (
                        <label key={key} className={`flex items-start gap-2 text-sm ${sub ? 'ps-6' : ''} ${blocked ? 'text-muted-foreground' : ''}`} title={t.maybe(def.description)}>
                          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={features.has(key)} disabled={blocked} onChange={(e) => toggleFeature(key, e.target.checked)} />
                          <span>{t.maybe(def.label)}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </section>

          <section aria-labelledby="pc-actions" className="space-y-2">
            <h3 id="pc-actions" className="text-sm font-semibold">
              {t('Actions')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('What it may do in each module. A dash means {parent} cannot do it either.', { parent: parent.name })}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-action-matrix>
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col" className="py-1 pe-2 text-start font-medium">
                      {t('Module')}
                    </th>
                    {WORKSPACE_ACTIONS.map((a) => (
                      <th key={a} scope="col" className="px-1 py-1 text-center font-medium">
                        {t.maybe(WORKSPACE_ACTION_LABEL[a])}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modules.map((g) => (
                    <tr key={g} className="border-t border-border">
                      <th scope="row" className="py-1.5 pe-2 text-start font-medium">
                        {t.maybe(g)}
                      </th>
                      {WORKSPACE_ACTIONS.map((a) => {
                        const allowed = (parent.actions[g] ?? []).includes(a);
                        return (
                          <td key={a} className="px-1 text-center">
                            {allowed ? (
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                aria-label={t('{action} in {module}', { action: t.maybe(WORKSPACE_ACTION_LABEL[a]), module: t.maybe(g) })}
                                checked={(actions[g] ?? []).includes(a)}
                                onChange={(e) => toggleAction(g, a, e.target.checked)}
                              />
                            ) : (
                              <span className="text-muted-foreground" aria-label={t('Not available')}>
                                –
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {managerSettings && (
            <section aria-labelledby="pc-manager" className="space-y-2">
              <h3 id="pc-manager" className="text-sm font-semibold">
                {t('Manager Workspace settings')}
              </h3>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={canCreateExecutives} onChange={(e) => { setSaved(false); setCanCreateExecutives(e.target.checked); }} />
                <span>{t('May create Executive Workspaces in its team')}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={canViewOtherManagers} onChange={(e) => { setSaved(false); setCanViewOtherManagers(e.target.checked); }} />
                <span>{t('May see other Manager Workspaces’ records')}</span>
              </label>
              <label className="flex items-start gap-2 text-sm" data-audit-setting>
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={canViewAuditLog} onChange={(e) => { setSaved(false); setCanViewAuditLog(e.target.checked); }} />
                <span>{t('May read its own team’s audit log')}</span>
              </label>
            </section>
          )}

          {row.level !== 'SUPER' && (
            <section aria-labelledby="pc-chat" className="space-y-2" data-chat-setting>
              <h3 id="pc-chat" className="text-sm font-semibold">
                {t('Chat')}
              </h3>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={canChatWithPeers} onChange={(e) => { setSaved(false); setCanChatWithPeers(e.target.checked); }} />
                <span>{row.level === 'MANAGER' ? t('May chat with other Manager Workspaces') : t('May chat with the other executives of its team')}</span>
              </label>
              <p className="text-xs text-muted-foreground">{t('Both workspaces need this before they can chat. The Super Workspace and their own manager can always reach them.')}</p>
            </section>
          )}

          <ErrorText error={permissions.error} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p role="status" aria-live="polite" className="me-auto text-sm text-muted-foreground">
              {saved ? t('Saved. It applies on its next request.') : ''}
            </p>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Close')}
            </Button>
            <Button type="submit" disabled={permissions.isPending}>
              {permissions.isPending ? t('Saving…') : t('Save permissions')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Creating and editing ─────────────

function CreateDialog({ level, tree, onClose }: { level: Creating; tree: WorkspaceTree; onClose: () => void }) {
  const t = useT();
  const { create } = useWorkspaceMutations();
  const managers = tree.workspaces.filter((w) => w.level === 'MANAGER');
  const isSuper = tree.mine.level === 'SUPER';
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [parentId, setParentId] = useState(isSuper ? '' : tree.mine.id);
  const [email, setEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{inviteUrl ? t('Workspace created') : level === 'MANAGER' ? t('New Manager Workspace') : t('New Executive Workspace')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {inviteUrl
            ? t('Send this link to the person. It works once and for seven days.')
            : t('It starts with what its parent workspace has, apart from actions this level never needs. Change that in its Permissions afterwards.')}
        </DialogDescription>
        {inviteUrl ? (
          <div className="mt-4 space-y-4">
            <div className="flex gap-2">
              <Input readOnly value={inviteUrl} aria-label={t('Invitation link')} />
              <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(inviteUrl)}>
                <Copy className="size-4" aria-hidden />
                {t('Copy')}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>{t('Done')}</Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const input: CreateWorkspaceInput = {
                level,
                name,
                ...(designation.trim() ? { designation } : {}),
                ...(level === 'EXECUTIVE' && parentId ? { parentId } : {}),
                ...(email.trim() ? { person: { inviteEmail: email.trim() } } : {}),
              };
              create.mutate(input, { onSuccess: (row) => (row.inviteUrl ? setInviteUrl(row.inviteUrl) : onClose()) });
            }}
          >
            <Field id="ws-name" label={t('Workspace name')}>
              <Input id="ws-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={level === 'MANAGER' ? t('For example: North India') : t('For example: Priya Sharma')} />
            </Field>
            <Field id="ws-designation" label={t('Designation')} hint={t('What the person in it is called, for example Regional Sales Manager.')}>
              <Input id="ws-designation" maxLength={80} value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder={level === 'MANAGER' ? t.maybe('Sales Manager') : t.maybe('Sales Executive')} />
            </Field>
            {level === 'EXECUTIVE' && isSuper && (
              <Field id="ws-parent" label={t('Reports to')}>
                <Select id="ws-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">{t('The Super Workspace directly')}</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field id="ws-email" label={t('Invite by email')} hint={t('Optional. You can also move an existing member in later.')}>
              <Input id="ws-email" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <ErrorText error={create.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? t('Saving…') : t('Create workspace')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ row, tree, onClose }: { row: WorkspaceRow; tree: WorkspaceTree; onClose: () => void }) {
  const t = useT();
  const { update, move, assign } = useWorkspaceMutations();
  const members = useMembers();
  const me = useSession().data?.user.id;
  const isSuper = tree.mine.level === 'SUPER';
  const rootId = roots(tree).find((w) => w.level === 'SUPER')?.id ?? null;
  const [name, setName] = useState(row.name);
  const [designation, setDesignation] = useState(row.designation);
  const [parentId, setParentId] = useState(row.parentId === rootId ? '' : (row.parentId ?? ''));
  const [person, setPerson] = useState('');
  const inHere = new Set(row.people.map((p) => p.userId));
  const error = update.error ?? move.error ?? assign.error;
  const pending = update.isPending || move.isPending || assign.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Edit {name}', { name: row.name })}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t.maybe(WORKSPACE_LEVEL_LABEL[row.level])}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const changes = { ...(name.trim() !== row.name ? { name } : {}), ...(designation.trim() !== row.designation ? { designation } : {}) };
              if (Object.keys(changes).length) await update.mutateAsync({ id: row.id, input: changes });
              const wantedParent = parentId || rootId;
              if (row.level === 'EXECUTIVE' && isSuper && wantedParent !== row.parentId) await move.mutateAsync({ id: row.id, parentId: parentId || null });
              if (person) await assign.mutateAsync({ id: row.id, userId: person });
              onClose();
            } catch {
              // Shown below from the mutation's error.
            }
          }}
        >
          <Field id="we-name" label={t('Workspace name')}>
            <Input id="we-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="we-designation" label={t('Designation')}>
            <Input id="we-designation" required minLength={2} maxLength={80} value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </Field>
          {row.level === 'EXECUTIVE' && isSuper && (
            <Field id="we-parent" label={t('Reports to')}>
              <Select id="we-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">{t('The Super Workspace directly')}</option>
                {tree.workspaces
                  .filter((w) => w.level === 'MANAGER')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          {isSuper && (row.level === 'MANAGER' || row.people.length === 0) && (
            <Field id="we-person" label={t('Move a member into it')} hint={t('They leave their current workspace.')}>
              <Select id="we-person" value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">{t('Nobody')}</option>
                {members.data
                  ?.filter((m) => m.status === 'ACTIVE' && !inHere.has(m.userId) && m.userId !== me)
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('Saving…') : t('Save changes')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

