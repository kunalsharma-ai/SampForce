'use client';

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import {
  type ActionGrants,
  type CreateWorkspaceInput,
  defaultChildActions,
  FEATURE_GROUPS,
  FEATURES,
  type FeatureGroup,
  WORKSPACE_ACTION_LABEL,
  WORKSPACE_ACTIONS,
  type WorkspaceAccessLevel,
  type WorkspaceAction,
  type WorkspaceEmailCheck,
  type WorkspaceRow,
  type WorkspaceTree,
} from '@dealflow/types';
import { Check, Copy, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useApprovalOverview } from '@/lib/team-approvals';
import { useWorkspaceMutations } from '@/lib/workspaces';

/*
 * The 6-step creation wizard (workspace redesign W5, spec sections 1, 2, 3 and 12): type, workspace, person,
 * permissions, review, create. The Super Workspace is never offered: an organisation has exactly one. The email is
 * checked while it is typed (one email, one role) and again by the API, which enforces every rule.
 */

type Level = 'MANAGER' | 'EXECUTIVE';
const STEPS = ['Type', 'Workspace', 'Person', 'Permissions', 'Review', 'Create'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{6,24}$/;

/** Answers whether an email can be given a new workspace, a moment after the person stops typing. */
function useEmailCheck(email: string): { checking: boolean; result: WorkspaceEmailCheck | null } {
  const [state, setState] = useState<{ checking: boolean; result: WorkspaceEmailCheck | null }>({ checking: false, result: null });
  useEffect(() => {
    const value = email.trim().toLowerCase();
    if (!EMAIL.test(value)) {
      setState({ checking: false, result: null });
      return;
    }
    let live = true;
    setState({ checking: true, result: null });
    const timer = setTimeout(() => {
      api<WorkspaceEmailCheck>(`/workspaces/email-check?email=${encodeURIComponent(value)}`)
        .then((result) => live && setState({ checking: false, result }))
        .catch(() => live && setState({ checking: false, result: null }));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [email]);
  return state;
}

export function CreateWorkspaceWizard({ tree, initialLevel, onClose }: { tree: WorkspaceTree; initialLevel: Level | null; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const { create } = useWorkspaceMutations();
  const isSuper = tree.mine.level === 'SUPER';
  const levels: Level[] = [...(tree.canCreate.managers ? (['MANAGER'] as const) : []), ...(tree.canCreate.executives ? (['EXECUTIVE'] as const) : [])];

  const [step, setStep] = useState(initialLevel ? 1 : 0);
  const [level, setLevel] = useState<Level>(initialLevel ?? levels[0] ?? 'EXECUTIVE');
  // Step 2: the workspace
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState(isSuper ? '' : tree.mine.id);
  const [executiveIds, setExecutiveIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  // Step 3: the person
  const [personName, setPersonName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const check = useEmailCheck(email);
  // Step 4: permissions
  const managers = tree.workspaces.filter((w) => w.level === 'MANAGER' && !w.deactivatedAt);
  const executives = tree.workspaces.filter((w) => w.level === 'EXECUTIVE');
  const parent: WorkspaceRow = (level === 'EXECUTIVE' && parentId ? tree.workspaces.find((w) => w.id === parentId) : undefined) ?? tree.mine;
  const modules = useMemo(() => FEATURE_GROUPS.filter((g) => (parent.actions[g] ?? []).length > 0), [parent]);
  const [groups, setGroups] = useState<Set<FeatureGroup>>(new Set(FEATURE_GROUPS));
  const rules = tree.rules;
  const ruleBlocksDelete = level === 'MANAGER' ? !rules.managerDelete : !rules.executiveDelete;
  // When the Super Workspace lets Manager and Executive Workspaces delete (Approvals > Rules, ADR 0098), a new one
  // starts with Delete wherever it gets Edit and the parent can hand Delete down; otherwise Delete starts off (W2).
  const lowerLevelsDelete = useApprovalOverview().data?.settings.lowerLevelsDelete ?? false;
  const startingActions = useMemo(() => {
    const base = defaultChildActions(level, parent.actions);
    if (!lowerLevelsDelete || ruleBlocksDelete) return base;
    const out = { ...base } as Record<string, string[]>;
    for (const [g, list] of Object.entries(base)) {
      if (list?.includes('edit') && (parent.actions[g as FeatureGroup] ?? []).includes('delete') && !list.includes('delete')) out[g] = [...list, 'delete'];
    }
    return out as ActionGrants;
  }, [level, parent, lowerLevelsDelete, ruleBlocksDelete]);
  const [actions, setActions] = useState<ActionGrants>(startingActions);
  const [accessLevel, setAccessLevel] = useState<WorkspaceAccessLevel>('TEAM');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  // A new level or parent starts again from what that parent can hand down.
  useEffect(() => setActions(startingActions), [startingActions]);

  const ruleModules = level === 'MANAGER' ? rules.managerModules : rules.executiveModules;
  const emailTaken = check.result?.available === false;
  const emailValid = !email.trim() || EMAIL.test(email.trim());
  const phoneValid = !phone.trim() || PHONE.test(phone.trim());

  const stepOk = [
    levels.includes(level),
    name.trim().length >= 2,
    emailValid && phoneValid && !emailTaken && !check.checking && (!email.trim() || personName.trim().length >= 2),
    true,
    true,
  ];

  const input = (): CreateWorkspaceInput => {
    const features = FEATURES.filter((f) => groups.has(f.group) && parent.features.includes(f.key)).map((f) => f.key);
    const granted: ActionGrants = {};
    for (const g of modules) granted[g] = groups.has(g) ? (actions[g] ?? []) : [];
    return {
      level,
      name: name.trim(),
      ...(designation.trim() ? { designation: designation.trim() } : {}),
      ...(department.trim() ? { department: department.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(level === 'EXECUTIVE' && parentId ? { parentId } : {}),
      ...(level === 'MANAGER' && executiveIds.length ? { executiveIds } : {}),
      ...(level === 'MANAGER' ? { accessLevel } : {}),
      ...(!active ? { status: 'DEACTIVATED' as const } : {}),
      features,
      actions: granted as CreateWorkspaceInput["actions"] & object,
      ...(email.trim() ? { person: { inviteEmail: email.trim(), ...(personName.trim() ? { name: personName.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) } } : {}),
    };
  };

  const submit = () =>
    create.mutate(input(), {
      onSuccess: (row) => {
        setCreated(row.name);
        setInviteUrl(row.inviteUrl ?? null);
      },
      onError: (e) => {
        // Back to the step that can fix it.
        if (e instanceof ApiError && (e.code === 'EMAIL_IN_WORKSPACE' || e.code === 'EMAIL_INVITED')) setStep(2);
        else if (e instanceof ApiError && e.code === 'WORKSPACE_NAME_TAKEN') setStep(1);
      },
    });

  const levelLabel = level === 'MANAGER' ? t('Manager Workspace') : t('Executive Workspace');
  const toggleAction = (g: FeatureGroup, a: WorkspaceAction, on: boolean) =>
    setActions((prev) => {
      const list = new Set(prev[g] ?? []);
      if (on) list.add(a);
      else list.delete(a);
      return { ...prev, [g]: WORKSPACE_ACTIONS.filter((x) => list.has(x)) };
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="top-[5%] max-h-[90vh] max-w-2xl overflow-y-auto p-6" data-workspace-wizard>
        <DialogTitle className="text-lg font-semibold">{created ? t('Workspace created') : t('Create a workspace')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('Your organisation has its one Super Workspace. Here you add Manager and Executive Workspaces below it.')}
        </DialogDescription>

        <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={t('Steps')}>
          {STEPS.map((s, i) => {
            const done = created ? true : i < step;
            return (
              <li key={s} aria-current={!created && i === step ? 'step' : undefined} className={`flex items-center gap-1.5 ${!created && i === step ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                <span className={`grid size-5 place-items-center rounded-full border text-[11px] ${done ? 'border-primary bg-primary text-primary-foreground' : !created && i === step ? 'border-primary' : 'border-border'}`} aria-hidden>
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                {t(s)}
              </li>
            );
          })}
        </ol>

        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (created) return onClose();
            if (step < 5 && stepOk[step]) setStep(step + 1);
            else if (step === 5) submit();
          }}
        >
          {created ? (
            <div className="space-y-3" data-wizard-done>
              <p className="text-sm">{t('{name} is ready.', { name: created })}</p>
              {inviteUrl ? (
                <>
                  <p className="text-sm text-muted-foreground">{t('Send this link to the person. It works once and for seven days.')}</p>
                  <div className="flex gap-2">
                    <Input readOnly value={inviteUrl} aria-label={t('Invitation link')} />
                    <Button type="button" variant="outline" onClick={() => void navigator.clipboard?.writeText(inviteUrl)}>
                      <Copy className="size-4" aria-hidden />
                      {t('Copy')}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('Nobody was invited. Invite its person later from Edit.')}</p>
              )}
            </div>
          ) : step === 0 ? (
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium">{t('What type of workspace do you want to create?')}</legend>
              {(['MANAGER', 'EXECUTIVE'] as const).map((l) => {
                const allowed = levels.includes(l);
                const Icon = l === 'MANAGER' ? UsersRound : UserRound;
                return (
                  <label key={l} className={`flex cursor-pointer gap-3 rounded-md border p-4 text-sm ${level === l ? 'border-primary bg-primary/5' : 'border-border'} ${allowed ? '' : 'cursor-not-allowed opacity-60'}`}>
                    <input type="radio" name={`${id}-level`} className="sr-only" checked={level === l} disabled={!allowed} onChange={() => setLevel(l)} />
                    <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                    <span className="space-y-1">
                      <span className="block font-medium">{l === 'MANAGER' ? t('Manager Workspace') : t('Executive Workspace')}</span>
                      <span className="block text-muted-foreground">
                        {l === 'MANAGER'
                          ? t('Runs a team: sees its executives’ work, sets their targets and tasks, and can be allowed to create Executive Workspaces.')
                          : t('One salesperson: works their own companies, contacts and tasks, and reports to a manager or to the Super Workspace.')}
                      </span>
                      {!allowed && <span className="block text-xs text-warning">{t('Not available: the limit is reached or it has not been allowed.')}</span>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : step === 1 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`${id}-name`} label={t('Workspace name')} className="sm:col-span-2">
                <Input id={`${id}-name`} required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={level === 'MANAGER' ? t('For example: North India') : t('For example: Priya Sharma')} autoFocus />
              </Field>
              <Field id={`${id}-dept`} label={t('Department or team')}>
                <Input id={`${id}-dept`} maxLength={80} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder={t('For example: Field Sales')} />
              </Field>
              <Field id={`${id}-designation`} label={t('Designation')}>
                <Input id={`${id}-designation`} maxLength={80} value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder={level === 'MANAGER' ? t.maybe('Sales Manager') : t.maybe('Sales Executive')} />
              </Field>
              <Field id={`${id}-description`} label={t('Description')} className="sm:col-span-2">
                <Textarea id={`${id}-description`} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('What this workspace is for')} />
              </Field>
              {level === 'EXECUTIVE' && isSuper && (
                <Field id={`${id}-parent`} label={t('Reports to')} className="sm:col-span-2">
                  <Select id={`${id}-parent`} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                    <option value="">{t('Directly to the Super Workspace')}</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {level === 'MANAGER' && isSuper && executives.length > 0 && (
                <fieldset className="space-y-1.5 text-sm sm:col-span-2" data-assign-executives>
                  <legend className="mb-1 font-medium">{t('Executive Workspaces in its team')}</legend>
                  <p className="text-xs text-muted-foreground">{t('Ticked ones move under the new manager, with their people and records.')}</p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {executives.map((x) => (
                      <label key={x.id} className="flex items-center gap-2">
                        <input type="checkbox" className="size-4 accent-primary" checked={executiveIds.includes(x.id)} onChange={(e) => setExecutiveIds((prev) => (e.target.checked ? [...prev, x.id] : prev.filter((v) => v !== x.id)))} />
                        {x.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <fieldset className="space-y-1.5 text-sm sm:col-span-2">
                <legend className="mb-1 font-medium">{t('Status')}</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name={`${id}-status`} className="size-4 accent-primary" checked={active} onChange={() => setActive(true)} />
                  {t('Active: its person can start as soon as they accept')}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name={`${id}-status`} className="size-4 accent-primary" checked={!active} onChange={() => setActive(false)} />
                  {t('Deactivated: prepare it now, switch it on later')}
                </label>
              </fieldset>
            </div>
          ) : step === 2 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <p className="text-sm text-muted-foreground sm:col-span-2">{t('The person gets a link and chooses their own password. Leave the email empty to invite them later.')}</p>
              <Field id={`${id}-person`} label={t('Full name')} error={email.trim() && personName.trim().length < 2 ? t('Enter their name') : undefined}>
                <Input id={`${id}-person`} maxLength={120} value={personName} onChange={(e) => setPersonName(e.target.value)} autoComplete="off" />
              </Field>
              <Field id={`${id}-phone`} label={t('Work phone')} error={phoneValid ? undefined : t('Enter a phone number with digits only, and an optional + at the start')}>
                <Input id={`${id}-phone`} type="tel" maxLength={24} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
              </Field>
              <Field
                id={`${id}-email`}
                label={t('Work email')}
                className="sm:col-span-2"
                hint={check.checking ? t('Checking…') : check.result?.available ? t('This email is free to use.') : undefined}
                error={!emailValid ? t('Enter a valid email address') : emailTaken ? check.result!.message : undefined}
              >
                <Input id={`${id}-email`} type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!emailValid || emailTaken} data-email-check={check.result ? (check.result.available ? 'free' : 'taken') : ''} />
              </Field>
            </div>
          ) : step === 3 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('It starts with what {parent} can hand down. Delete is off: turn it on only where it is needed.', { parent: parent.id === tree.mine.id && isSuper ? t('the Super Workspace') : parent.name })}
              </p>
              {ruleBlocksDelete && <p className="rounded-md bg-warning/10 px-3 py-2 text-sm" data-rule-note="delete">{t('Your SampForce plan does not let this level delete data, so Delete cannot be given here.')}</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-wizard-permissions>
                  <thead>
                    <tr className="text-start text-xs text-muted-foreground">
                      <th scope="col" className="py-1 pe-3 text-start font-medium">{t('Module')}</th>
                      <th scope="col" className="py-1 text-start font-medium">{t('Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((g) => {
                      const blocked = !ruleModules.includes(g);
                      const on = groups.has(g) && !blocked;
                      return (
                        <tr key={g} className="border-t border-border align-top">
                          <td className="py-2 pe-3">
                            <label className="flex items-center gap-2 font-medium">
                              <input type="checkbox" className="size-4 accent-primary" disabled={blocked} checked={on} onChange={(e) => setGroups((prev) => { const next = new Set(prev); if (e.target.checked) next.add(g); else next.delete(g); return next; })} aria-label={t('Use {module}', { module: t.maybe(g) })} />
                              {t.maybe(g)}
                            </label>
                          </td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                              {(parent.actions[g] ?? [])
                                .filter((a) => !(a === 'delete' && ruleBlocksDelete))
                                .map((a) => (
                                  <label key={a} className={`flex items-center gap-1.5 ${on ? '' : 'opacity-50'}`}>
                                    <input type="checkbox" className="size-4 accent-primary" disabled={!on} checked={(actions[g] ?? []).includes(a)} onChange={(e) => toggleAction(g, a, e.target.checked)} aria-label={t('{action} in {module}', { action: t.maybe(WORKSPACE_ACTION_LABEL[a]), module: t.maybe(g) })} />
                                    {t.maybe(WORKSPACE_ACTION_LABEL[a])}
                                  </label>
                                ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {level === 'MANAGER' && (
                <fieldset className="space-y-1.5 text-sm" data-access-level>
                  <legend className="mb-1 font-medium">{t('Access level')}</legend>
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`${id}-access`} className="size-4 accent-primary" checked={accessLevel === 'TEAM'} onChange={() => setAccessLevel('TEAM')} />
                    {t('Team: its own records and those of its Executive Workspaces')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`${id}-access`} className="size-4 accent-primary" checked={accessLevel === 'OWN'} onChange={() => setAccessLevel('OWN')} />
                    {t('Standard: only its own records')}
                  </label>
                </fieldset>
              )}
            </div>
          ) : step === 5 ? (
            <div className="space-y-2 rounded-md border border-border p-4 text-sm" data-wizard-confirm>
              <p className="font-medium">{t('Create the {level} {name}?', { name: name.trim(), level: levelLabel })}</p>
              <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
                <li>{t('It counts towards your plan’s limit for this level.')}</li>
                {email.trim() && <li>{t('An invitation link is made for {email}. They choose their own password.', { email: email.trim() })}</li>}
                {!active && <li>{t('It starts deactivated: reactivate it when its person should begin.')}</li>}
                {executiveIds.length > 0 && <li>{t('{count} Executive Workspaces move into its team.', { count: executiveIds.length })}</li>}
              </ul>
            </div>
          ) : (
            <dl className="grid gap-x-6 gap-y-3 rounded-md border border-border p-4 text-sm sm:grid-cols-[10rem_1fr]" data-wizard-review>
              <dt className="font-medium">{t('Type')}</dt>
              <dd>{levelLabel}</dd>
              <dt className="font-medium">{t('Workspace name')}</dt>
              <dd>
                {name.trim()} {!active && <Badge tone="warning">{t('Deactivated')}</Badge>}
              </dd>
              {(department.trim() || designation.trim()) && (
                <>
                  <dt className="font-medium">{t('Team and designation')}</dt>
                  <dd>{[department.trim(), designation.trim() || (level === 'MANAGER' ? t.maybe('Sales Manager') : t.maybe('Sales Executive'))].filter(Boolean).join(' · ')}</dd>
                </>
              )}
              {level === 'EXECUTIVE' && (
                <>
                  <dt className="font-medium">{t('Reports to')}</dt>
                  <dd>{parent.id === tree.mine.id && isSuper ? t('Super Workspace') : parent.name}</dd>
                </>
              )}
              {executiveIds.length > 0 && (
                <>
                  <dt className="font-medium">{t('Executive Workspaces in its team')}</dt>
                  <dd>{executives.filter((x) => executiveIds.includes(x.id)).map((x) => x.name).join(', ')}</dd>
                </>
              )}
              <dt className="font-medium">{t('User')}</dt>
              <dd>{email.trim() ? [personName.trim(), email.trim(), phone.trim()].filter(Boolean).join(' · ') : t('Nobody yet')}</dd>
              <dt className="font-medium">{t('Role')}</dt>
              <dd>{designation.trim() || (level === 'MANAGER' ? t.maybe('Sales Manager') : t.maybe('Sales Executive'))}</dd>
              <dt className="font-medium">{t('Permissions')}</dt>
              <dd data-review-permissions>
                {modules
                  .filter((g) => groups.has(g) && ruleModules.includes(g))
                  .map((g) => `${t.maybe(g)}: ${(actions[g] ?? []).map((a) => t.maybe(WORKSPACE_ACTION_LABEL[a])).join(', ') || t('None')}`)
                  .join(' · ')}
              </dd>
              {level === 'MANAGER' && (
                <>
                  <dt className="font-medium">{t('Access level')}</dt>
                  <dd>{accessLevel === 'TEAM' ? t('Team: its own records and those of its Executive Workspaces') : t('Standard: only its own records')}</dd>
                </>
              )}
            </dl>
          )}

          <ErrorText error={create.error} />
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            {created ? (
              <span />
            ) : (
              <Button type="button" variant="outline" onClick={() => (step === 0 || (step === 1 && initialLevel && levels.length < 2) ? onClose() : setStep(step - 1))} disabled={create.isPending}>
                {step === 0 ? t('Cancel') : t('Back')}
              </Button>
            )}
            <Button type="submit" disabled={!created && ((step < 5 && !stepOk[step]) || create.isPending)}>
              {created ? t('Done') : step === 4 ? t('Continue') : step === 5 ? (create.isPending ? t('Creating…') : t('Create workspace')) : t('Next')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
