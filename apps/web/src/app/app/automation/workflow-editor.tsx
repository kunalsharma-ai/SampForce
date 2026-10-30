'use client';

import { Badge, Button, Card, CardContent, Input, Label } from '@dealflow/ui';
import {
  CONDITION_OPS,
  type ConditionGroup,
  type ConditionRule,
  LEAD_STATUSES,
  TRIGGER_EVENT_KEYS,
  TRIGGER_EVENTS,
  type TriggerEvent,
  UPDATABLE_FIELDS,
  type WorkflowAction,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@dealflow/types';
import { Clock, GitBranch, Plus, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { useId, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { useMembers } from '@/lib/crm';
import {
  ACTION_LABELS,
  CONDITION_FIELDS,
  defaultAction,
  entityOf,
  EXTERNAL,
  insertAt,
  type NodeType,
  OP_LABELS,
  readSlot,
  removeNode,
  type Slot,
  updateNode,
} from './workflow-model';

interface Props {
  definition: WorkflowDefinition;
  onChange: (def: WorkflowDefinition) => void;
  readOnly?: boolean;
}

/**
 * Structured visual editor. The workflow is drawn as a vertical flow from the trigger; conditions and
 * approvals split into labelled branches. Every edit produces a new definition object.
 */
export function WorkflowEditor({ definition, onChange, readOnly }: Props) {
  const entity = entityOf(definition.trigger.event);
  return (
    <div className="space-y-3">
      <TriggerCard definition={definition} onChange={onChange} readOnly={readOnly} />
      <Branch slot={{ kind: 'start' }} definition={definition} onChange={onChange} entity={entity} readOnly={readOnly} depth={0} />
    </div>
  );
}

function TriggerCard({ definition, onChange, readOnly }: Props) {
  const id = useId();
  const event = definition.trigger.event;
  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">When</h3>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-event`}>Trigger</Label>
          <Select
            id={`${id}-event`}
            disabled={readOnly}
            value={event}
            onChange={(e) => {
              const next = e.target.value as TriggerEvent;
              // Field updates and tags depend on the record type, so a type change clears trigger conditions.
              const sameEntity = entityOf(next) === entityOf(event);
              onChange({ ...definition, trigger: { event: next, conditions: sameEntity ? definition.trigger.conditions : { match: 'all', rules: [] } } });
            }}
          >
            {TRIGGER_EVENT_KEYS.map((k) => (
              <option key={k} value={k}>
                {TRIGGER_EVENTS[k].label}
              </option>
            ))}
          </Select>
        </div>
        <ConditionEditor
          label="Only when"
          entity={entityOf(event)}
          value={definition.trigger.conditions ?? { match: 'all', rules: [] }}
          onChange={(conditions) => onChange({ ...definition, trigger: { ...definition.trigger, conditions } })}
          readOnly={readOnly}
          emptyText="Runs for every matching event."
        />
      </CardContent>
    </Card>
  );
}

function ConditionEditor({
  label,
  entity,
  value,
  onChange,
  readOnly,
  emptyText,
}: {
  label: string;
  entity: string;
  value: ConditionGroup;
  onChange: (v: ConditionGroup) => void;
  readOnly?: boolean;
  emptyText: string;
}) {
  const id = useId();
  const fields = CONDITION_FIELDS[entity] ?? [];
  const setRule = (i: number, patch: Partial<ConditionRule>) => onChange({ ...value, rules: value.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <fieldset className="space-y-2">
      <legend className="flex items-center gap-2 text-sm font-medium">
        {label}
        {value.rules.length > 1 && (
          <>
            <label htmlFor={`${id}-match`} className="sr-only">
              Match
            </label>
            <Select id={`${id}-match`} className="h-7 w-24 text-xs" disabled={readOnly} value={value.match} onChange={(e) => onChange({ ...value, match: e.target.value as 'all' | 'any' })}>
              <option value="all">all of</option>
              <option value="any">any of</option>
            </Select>
          </>
        )}
      </legend>
      {value.rules.length === 0 && <p className="text-xs text-muted-foreground">{emptyText}</p>}
      {value.rules.map((r, i) => {
        const needsValue = r.op !== 'empty' && r.op !== 'not_empty';
        const known = fields.some((f) => f.value === r.field);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-f${i}`} className="sr-only">
              Field
            </label>
            <Select id={`${id}-f${i}`} className="h-9 w-48" disabled={readOnly} value={known ? r.field : '__custom'} onChange={(e) => setRule(i, { field: e.target.value === '__custom' ? 'record.' : e.target.value })}>
              {fields.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
              <option value="__custom">Other field…</option>
            </Select>
            {!known && (
              <>
                <label htmlFor={`${id}-p${i}`} className="sr-only">
                  Field path
                </label>
                <Input id={`${id}-p${i}`} className="h-9 w-48" disabled={readOnly} value={r.field} onChange={(e) => setRule(i, { field: e.target.value })} placeholder="record.customFields.tier" />
              </>
            )}
            <label htmlFor={`${id}-o${i}`} className="sr-only">
              Operator
            </label>
            <Select id={`${id}-o${i}`} className="h-9 w-40" disabled={readOnly} value={r.op} onChange={(e) => setRule(i, { op: e.target.value as ConditionRule['op'] })}>
              {CONDITION_OPS.map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </Select>
            {needsValue && (
              <>
                <label htmlFor={`${id}-v${i}`} className="sr-only">
                  Value
                </label>
                <Input
                  id={`${id}-v${i}`}
                  className="h-9 w-40"
                  disabled={readOnly}
                  value={Array.isArray(r.value) ? r.value.join(', ') : String(r.value ?? '')}
                  placeholder={r.op === 'in' ? 'a, b, c' : 'Value'}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const numeric = ['gt', 'gte', 'lt', 'lte'].includes(r.op) && raw.trim() !== '' && !Number.isNaN(Number(raw));
                    setRule(i, { value: r.op === 'in' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : numeric ? Number(raw) : raw });
                  }}
                />
              </>
            )}
            {!readOnly && (
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove rule ${i + 1}`} onClick={() => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })}>
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        );
      })}
      {!readOnly && value.rules.length < 20 && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, rules: [...value.rules, { field: fields[0]?.value ?? 'record.', op: 'eq', value: '' }] })}>
          <Plus aria-hidden /> Add rule
        </Button>
      )}
    </fieldset>
  );
}

/** Renders the chain of steps hanging off one pointer, with an "add step" control at its end. */
function Branch({ slot, definition, onChange, entity, readOnly, depth }: { slot: Slot; definition: WorkflowDefinition; onChange: (d: WorkflowDefinition) => void; entity: string; readOnly?: boolean; depth: number }) {
  const chain: { node: WorkflowNode; slot: Slot }[] = [];
  let cursor: Slot = slot;
  const seen = new Set<string>();
  for (;;) {
    const id = readSlot(definition, cursor);
    if (!id || seen.has(id)) break;
    seen.add(id);
    const node = definition.nodes.find((n) => n.id === id);
    if (!node) break;
    chain.push({ node, slot: cursor });
    // Branching steps end the linear chain; their branches render inside the step card.
    if (node.type === 'condition') break;
    cursor = { kind: 'next', nodeId: node.id };
  }
  const tail = chain.at(-1);
  const endSlot: Slot | null = !tail ? slot : tail.node.type === 'condition' ? null : { kind: 'next', nodeId: tail.node.id };

  return (
    <ol className="space-y-3" aria-label={depth === 0 ? 'Workflow steps' : undefined}>
      {chain.map(({ node }) => (
        <li key={node.id}>
          <StepCard node={node} definition={definition} onChange={onChange} entity={entity} readOnly={readOnly} depth={depth} />
        </li>
      ))}
      {endSlot && !readOnly && (
        <li>
          <AddStep onAdd={(type) => onChange(insertAt(definition, endSlot, type))} label={chain.length === 0 ? (depth === 0 ? 'Add the first step' : 'Add a step to this branch') : 'Add step'} />
        </li>
      )}
      {endSlot && readOnly && chain.length === 0 && <li className="text-xs text-muted-foreground">No steps.</li>}
    </ol>
  );
}

function AddStep({ onAdd, label }: { onAdd: (t: NodeType) => void; label: string }) {
  const id = useId();
  const [type, setType] = useState<NodeType>('action');
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2">
      <label htmlFor={id} className="sr-only">
        Step type
      </label>
      <Select id={id} className="h-8 w-44 text-xs" value={type} onChange={(e) => setType(e.target.value as NodeType)}>
        <option value="action">Action</option>
        <option value="condition">If / else branch</option>
        <option value="delay">Wait</option>
        <option value="approval">Approval</option>
      </Select>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd(type)}>
        <Plus aria-hidden /> {label}
      </Button>
    </div>
  );
}

const ICONS = { action: Zap, condition: GitBranch, delay: Clock, approval: ShieldCheck } as const;
const TITLES = { action: 'Action', condition: 'If / else', delay: 'Wait', approval: 'Approval' } as const;

function StepCard({ node, definition, onChange, entity, readOnly, depth }: { node: WorkflowNode; definition: WorkflowDefinition; onChange: (d: WorkflowDefinition) => void; entity: string; readOnly?: boolean; depth: number }) {
  const Icon = ICONS[node.type];
  const set = (patch: Partial<WorkflowNode>) => onChange(updateNode(definition, node.id, patch));
  const external = node.type === 'action' && EXTERNAL.has(node.action.type);
  return (
    <Card data-testid={`step-${node.id}`}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-semibold">{TITLES[node.type]}</h3>
          <span className="font-mono text-[11px] text-muted-foreground">{node.id}</span>
          {external && <Badge tone="warning">Needs approval each run</Badge>}
          {!readOnly && (
            <Button type="button" variant="ghost" size="icon" className="ml-auto" aria-label={`Delete step ${node.id}`} onClick={() => onChange(removeNode(definition, node.id))}>
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>

        {node.type === 'action' && <ActionFields node={node} entity={entity} readOnly={readOnly} onChange={(action) => set({ action } as Partial<WorkflowNode>)} />}

        {node.type === 'delay' && <DelayFields node={node} readOnly={readOnly} onChange={set} />}

        {node.type === 'approval' && (
          <TextField label="What should the approver confirm?" value={node.title} readOnly={readOnly} maxLength={200} onChange={(title) => set({ title } as Partial<WorkflowNode>)} />
        )}

        {node.type === 'condition' && (
          <ConditionEditor
            label="If"
            entity={entity}
            value={node.condition}
            readOnly={readOnly}
            emptyText="With no rules, the “yes” branch always runs."
            onChange={(condition) => set({ condition } as Partial<WorkflowNode>)}
          />
        )}

        {node.type === 'condition' && (
          <div className="grid gap-3 md:grid-cols-2">
            <BranchBox title="Yes">
              <Branch slot={{ kind: 'onTrue', nodeId: node.id }} definition={definition} onChange={onChange} entity={entity} readOnly={readOnly} depth={depth + 1} />
            </BranchBox>
            <BranchBox title="No">
              <Branch slot={{ kind: 'onFalse', nodeId: node.id }} definition={definition} onChange={onChange} entity={entity} readOnly={readOnly} depth={depth + 1} />
            </BranchBox>
          </div>
        )}
        {node.type === 'approval' && (
          <BranchBox title="If rejected">
            <Branch slot={{ kind: 'onReject', nodeId: node.id }} definition={definition} onChange={onChange} entity={entity} readOnly={readOnly} depth={depth + 1} />
          </BranchBox>
        )}
      </CardContent>
    </Card>
  );
}

function BranchBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-border bg-muted/30 p-3" aria-label={`${title} branch`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function TextField({ label, value, onChange, readOnly, maxLength, multiline, hint }: { label: string; value: string; onChange: (v: string) => void; readOnly?: boolean; maxLength: number; multiline?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea id={id} value={value} disabled={readOnly} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
      ) : (
        <Input id={id} value={value} disabled={readOnly} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function DelayFields({ node, readOnly, onChange }: { node: Extract<WorkflowNode, { type: 'delay' }>; readOnly?: boolean; onChange: (p: Partial<WorkflowNode>) => void }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-n`}>Wait for</Label>
        <Input id={`${id}-n`} type="number" min={1} max={365} className="w-24" disabled={readOnly} value={node.amount} onChange={(e) => onChange({ amount: Math.max(1, Math.min(365, Number(e.target.value) || 1)) } as Partial<WorkflowNode>)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-u`}>Unit</Label>
        <Select id={`${id}-u`} className="w-32" disabled={readOnly} value={node.unit} onChange={(e) => onChange({ unit: e.target.value } as Partial<WorkflowNode>)}>
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </Select>
      </div>
    </div>
  );
}

function PersonSelect({ label, value, onChange, readOnly }: { label: string; value: string; onChange: (v: string) => void; readOnly?: boolean }) {
  const id = useId();
  const members = useMembers();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} disabled={readOnly} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="record_owner">The record’s owner</option>
        <option value="trigger_actor">The person who made the change</option>
        {members.data?.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

const TEMPLATE_HINT = 'Insert record fields with {{record.field}}, for example {{record.fullName}}.';

function ActionFields({ node, entity, readOnly, onChange }: { node: Extract<WorkflowNode, { type: 'action' }>; entity: string; readOnly?: boolean; onChange: (a: WorkflowAction) => void }) {
  const id = useId();
  const a = node.action;
  const members = useMembers();
  const allowed = (Object.keys(ACTION_LABELS) as WorkflowAction['type'][]).filter(
    (t) => (t !== 'update_field' || entity in UPDATABLE_FIELDS) && (t !== 'add_tag' || entity === 'lead') && (t !== 'assign_owner' || entity !== 'activity'),
  );
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-type`}>Do this</Label>
        <Select id={`${id}-type`} disabled={readOnly} value={a.type} onChange={(e) => onChange(defaultAction(e.target.value as WorkflowAction['type']))}>
          {allowed.map((t) => (
            <option key={t} value={t}>
              {ACTION_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>

      {a.type === 'create_task' && (
        <>
          <TextField label="Task title" value={a.title} readOnly={readOnly} maxLength={200} hint={TEMPLATE_HINT} onChange={(title) => onChange({ ...a, title })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-due`}>Due in (days)</Label>
              <Input id={`${id}-due`} type="number" min={0} max={365} disabled={readOnly} value={a.dueInDays ?? ''} onChange={(e) => onChange({ ...a, dueInDays: e.target.value === '' ? undefined : Math.max(0, Math.min(365, Number(e.target.value))) })} />
            </div>
            <PersonSelect label="Assign to" value={a.assignTo} readOnly={readOnly} onChange={(assignTo) => onChange({ ...a, assignTo })} />
          </div>
        </>
      )}

      {a.type === 'assign_owner' && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Assign to</legend>
          <Select aria-label="Assignment mode" disabled={readOnly} value={a.mode} onChange={(e) => onChange({ ...a, mode: e.target.value as 'round_robin' | 'user', userIds: e.target.value === 'user' ? a.userIds.slice(0, 1) : a.userIds })}>
            <option value="round_robin">Rotate between people (round robin)</option>
            <option value="user">One person</option>
          </Select>
          <div className="grid gap-1 sm:grid-cols-2">
            {members.data?.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 text-sm">
                <input
                  type={a.mode === 'user' ? 'radio' : 'checkbox'}
                  name={`${id}-users`}
                  className="size-4 accent-[hsl(var(--primary))]"
                  disabled={readOnly}
                  checked={a.userIds.includes(m.userId)}
                  onChange={(e) =>
                    onChange({ ...a, userIds: a.mode === 'user' ? [m.userId] : e.target.checked ? [...a.userIds, m.userId] : a.userIds.filter((u) => u !== m.userId) })
                  }
                />
                {m.name}
              </label>
            ))}
          </div>
          {a.userIds.length === 0 && <p className="text-xs text-warning">Choose at least one person.</p>}
        </fieldset>
      )}

      {a.type === 'update_field' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-field`}>Field</Label>
            <Select id={`${id}-field`} disabled={readOnly} value={a.field} onChange={(e) => onChange({ ...a, field: e.target.value, value: e.target.value === 'status' ? 'CONTACTED' : e.target.value === 'probability' ? 50 : '' })}>
              {((UPDATABLE_FIELDS as Record<string, readonly string[]>)[entity] ?? []).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-val`}>New value</Label>
            {a.field === 'status' ? (
              <Select id={`${id}-val`} disabled={readOnly} value={String(a.value ?? '')} onChange={(e) => onChange({ ...a, value: e.target.value })}>
                {LEAD_STATUSES.filter((s) => s !== 'CONVERTED').map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            ) : a.field === 'probability' ? (
              <Input id={`${id}-val`} type="number" min={0} max={100} disabled={readOnly} value={a.value ?? ''} onChange={(e) => onChange({ ...a, value: e.target.value === '' ? null : Number(e.target.value) })} />
            ) : (
              <Input id={`${id}-val`} disabled={readOnly} maxLength={200} value={String(a.value ?? '')} onChange={(e) => onChange({ ...a, value: e.target.value })} />
            )}
          </div>
        </div>
      )}

      {a.type === 'add_tag' && <TextField label="Tag" value={a.tag} readOnly={readOnly} maxLength={40} onChange={(tag) => onChange({ ...a, tag })} />}

      {a.type === 'notify' && (
        <>
          <PersonSelect label="Notify" value={a.to} readOnly={readOnly} onChange={(to) => onChange({ ...a, to })} />
          <TextField label="Message" value={a.title} readOnly={readOnly} maxLength={200} hint={TEMPLATE_HINT} onChange={(title) => onChange({ ...a, title })} />
        </>
      )}

      {a.type === 'log_note' && (
        <>
          <TextField label="Subject" value={a.subject} readOnly={readOnly} maxLength={200} hint={TEMPLATE_HINT} onChange={(subject) => onChange({ ...a, subject })} />
          <TextField label="Note" multiline value={a.body ?? ''} readOnly={readOnly} maxLength={5000} onChange={(body) => onChange({ ...a, body: body || undefined })} />
        </>
      )}

      {a.type === 'send_webhook' && (
        <TextField
          label="Endpoint URL"
          value={a.url}
          readOnly={readOnly}
          maxLength={2000}
          hint="Posts the record as JSON after someone approves the run. Private network addresses are refused."
          onChange={(url) => onChange({ ...a, url })}
        />
      )}

      {a.type === 'send_email' && (
        <>
          <p className="text-xs text-muted-foreground">
            Sends one email to the record’s email address from the workflow owner’s connected mailbox, after someone approves the run.
          </p>
          <TextField label="Subject" value={a.subject} readOnly={readOnly} maxLength={200} onChange={(subject) => onChange({ ...a, subject })} />
          <TextField label="Body" multiline value={a.body} readOnly={readOnly} maxLength={10_000} hint={TEMPLATE_HINT} onChange={(body) => onChange({ ...a, body })} />
        </>
      )}
    </div>
  );
}
