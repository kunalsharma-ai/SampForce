import {
  type ConditionRule,
  type TriggerEvent,
  TRIGGER_EVENTS,
  type WorkflowAction,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@dealflow/types';

/** Pointer slots that link one step to the next. */
export type Slot = { kind: 'start' } | { kind: 'next' | 'onTrue' | 'onFalse' | 'onReject'; nodeId: string };

export type NodeType = WorkflowNode['type'];

export const ACTION_LABELS: Record<WorkflowAction['type'], string> = {
  create_task: 'Create a task',
  assign_owner: 'Assign an owner',
  update_field: 'Update a field',
  add_tag: 'Add a tag',
  notify: 'Send an in-app notification',
  log_note: 'Log a note',
  send_webhook: 'Send to a webhook URL',
  send_email: 'Send an email',
};

export const EXTERNAL = new Set<WorkflowAction['type']>(['send_webhook', 'send_email']);

/** Fields conditions commonly use, per record type. Free text is allowed too. */
export const CONDITION_FIELDS: Record<string, { value: string; label: string }[]> = {
  lead: [
    { value: 'record.status', label: 'Status' },
    { value: 'record.estimatedValue', label: 'Estimated value' },
    { value: 'record.source', label: 'Source' },
    { value: 'record.industry', label: 'Industry' },
    { value: 'record.country', label: 'Country' },
    { value: 'record.email', label: 'Email' },
    { value: 'record.tags', label: 'Tags' },
    { value: 'record.owner.id', label: 'Owner (user id)' },
  ],
  deal: [
    { value: 'record.amount', label: 'Amount' },
    { value: 'record.status', label: 'Status' },
    { value: 'record.stage.name', label: 'Stage name' },
    { value: 'record.probability', label: 'Probability' },
    { value: 'record.pipeline.name', label: 'Pipeline name' },
    { value: 'event.to', label: 'Moved to stage (stage change only)' },
    { value: 'event.from', label: 'Moved from stage (stage change only)' },
  ],
  contact: [
    { value: 'record.email', label: 'Email' },
    { value: 'record.jobTitle', label: 'Job title' },
    { value: 'record.country', label: 'Country' },
  ],
  company: [
    { value: 'record.industry', label: 'Industry' },
    { value: 'record.country', label: 'Country' },
    { value: 'record.domain', label: 'Domain' },
  ],
  task: [
    { value: 'record.title', label: 'Title' },
    { value: 'record.assignee.id', label: 'Assignee (user id)' },
  ],
  activity: [
    { value: 'record.type', label: 'Type' },
    { value: 'record.subject', label: 'Subject' },
  ],
};

export const OP_LABELS: Record<ConditionRule['op'], string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
  in: 'is one of',
  empty: 'is empty',
  not_empty: 'is not empty',
};

export const entityOf = (event: TriggerEvent) => TRIGGER_EVENTS[event].entity;

export function emptyDefinition(event: TriggerEvent = 'lead.created'): WorkflowDefinition {
  return { trigger: { event, conditions: { match: 'all', rules: [] } }, start: null, nodes: [] };
}

export function newId(def: WorkflowDefinition, type: NodeType): string {
  const used = new Set(def.nodes.map((n) => n.id));
  for (let i = 1; ; i++) {
    const id = `${type}_${i}`;
    if (!used.has(id)) return id;
  }
}

export function defaultNode(id: string, type: NodeType, next: string | null): WorkflowNode {
  switch (type) {
    case 'action':
      return { id, type, action: { type: 'create_task', title: 'Follow up with {{record.fullName}}', assignTo: 'record_owner' }, next };
    case 'condition':
      return { id, type, condition: { match: 'all', rules: [] }, onTrue: next, onFalse: null };
    case 'delay':
      return { id, type, amount: 1, unit: 'days', next };
    case 'approval':
      return { id, type, title: 'Manager approval', next, onReject: null };
  }
}

export function readSlot(def: WorkflowDefinition, slot: Slot): string | null {
  if (slot.kind === 'start') return def.start;
  const n = def.nodes.find((x) => x.id === slot.nodeId) as Record<string, unknown> | undefined;
  return (n?.[slot.kind] as string | null | undefined) ?? null;
}

export function writeSlot(def: WorkflowDefinition, slot: Slot, target: string | null): WorkflowDefinition {
  if (slot.kind === 'start') return { ...def, start: target };
  return { ...def, nodes: def.nodes.map((n) => (n.id === slot.nodeId ? ({ ...n, [slot.kind]: target } as WorkflowNode) : n)) };
}

/** Inserts a new step into a slot; the step continues to whatever the slot pointed at. */
export function insertAt(def: WorkflowDefinition, slot: Slot, type: NodeType): WorkflowDefinition {
  const id = newId(def, type);
  const node = defaultNode(id, type, readSlot(def, slot));
  return writeSlot({ ...def, nodes: [...def.nodes, node] }, slot, id);
}

const outgoing = (n: WorkflowNode): (string | null)[] =>
  n.type === 'condition' ? [n.onTrue, n.onFalse] : n.type === 'approval' ? [n.next, n.onReject] : [n.next];

/**
 * Removes a step. Linear steps are spliced out. Branching steps take their "otherwise" branches with
 * them and keep the main path ("yes" / "approved").
 */
export function removeNode(def: WorkflowDefinition, id: string): WorkflowDefinition {
  const node = def.nodes.find((n) => n.id === id);
  if (!node) return def;
  const keep = node.type === 'condition' ? node.onTrue : node.next;
  const drop = new Set<string>([id]);
  const dropBranch = node.type === 'condition' ? node.onFalse : node.type === 'approval' ? node.onReject : null;
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const stack = dropBranch ? [dropBranch] : [];
  while (stack.length) {
    const cur = stack.pop()!;
    if (drop.has(cur) || cur === keep) continue;
    drop.add(cur);
    const n = byId.get(cur);
    if (n) for (const r of outgoing(n)) if (r) stack.push(r);
  }
  const relink = (r: string | null) => (r === id ? keep : r && drop.has(r) ? null : r);
  return {
    ...def,
    start: relink(def.start),
    nodes: def.nodes
      .filter((n) => !drop.has(n.id))
      .map((n) =>
        n.type === 'condition'
          ? { ...n, onTrue: relink(n.onTrue), onFalse: relink(n.onFalse) }
          : n.type === 'approval'
            ? { ...n, next: relink(n.next), onReject: relink(n.onReject) }
            : { ...n, next: relink(n.next) },
      ),
  };
}

export function updateNode(def: WorkflowDefinition, id: string, patch: Partial<WorkflowNode>): WorkflowDefinition {
  return { ...def, nodes: def.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as WorkflowNode) : n)) };
}

export function defaultAction(type: WorkflowAction['type']): WorkflowAction {
  switch (type) {
    case 'create_task':
      return { type, title: 'Follow up with {{record.fullName}}', assignTo: 'record_owner' };
    case 'assign_owner':
      return { type, mode: 'round_robin', userIds: [] };
    case 'update_field':
      return { type, field: 'status', value: 'CONTACTED' };
    case 'add_tag':
      return { type, tag: 'hot' };
    case 'notify':
      return { type, to: 'record_owner', title: 'Heads up' };
    case 'log_note':
      return { type, subject: 'Automated note' };
    case 'send_webhook':
      return { type, url: 'https://' };
    case 'send_email':
      return { type, subject: 'Following up', body: 'Hi {{record.fullName}},\n\n' };
  }
}

export interface Template {
  key: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
}

export const TEMPLATES: Template[] = [
  {
    key: 'hot-leads',
    name: 'Follow up on high-value leads',
    description: 'When a lead worth 50,000 or more arrives, tag it, create a same-day call task and check back after two days.',
    definition: {
      trigger: { event: 'lead.created', conditions: { match: 'all', rules: [{ field: 'record.estimatedValue', op: 'gte', value: 50000 }] } },
      start: 'action_1',
      nodes: [
        { id: 'action_1', type: 'action', action: { type: 'add_tag', tag: 'high-value' }, next: 'action_2' },
        { id: 'action_2', type: 'action', action: { type: 'create_task', title: 'Call {{record.fullName}} today', dueInDays: 0, assignTo: 'record_owner' }, next: 'delay_1' },
        { id: 'delay_1', type: 'delay', amount: 2, unit: 'days', next: 'condition_1' },
        {
          id: 'condition_1',
          type: 'condition',
          condition: { match: 'all', rules: [{ field: 'record.status', op: 'eq', value: 'NEW' }] },
          onTrue: 'action_3',
          onFalse: null,
        },
        { id: 'action_3', type: 'action', action: { type: 'notify', to: 'record_owner', title: '{{record.fullName}} is still new after two days' }, next: null },
      ],
    },
  },
  {
    key: 'won-deals',
    name: 'Celebrate and hand over won deals',
    description: 'When a deal is won, notify its owner and create an onboarding hand-over task.',
    definition: {
      trigger: { event: 'deal.won', conditions: { match: 'all', rules: [] } },
      start: 'action_1',
      nodes: [
        { id: 'action_1', type: 'action', action: { type: 'notify', to: 'record_owner', title: 'You won {{record.name}}' }, next: 'action_2' },
        { id: 'action_2', type: 'action', action: { type: 'create_task', title: 'Hand over {{record.name}} to onboarding', dueInDays: 2, assignTo: 'record_owner' }, next: null },
      ],
    },
  },
  {
    key: 'new-contact',
    name: 'Welcome new contacts',
    description: 'When a contact with an email is added, ask a manager to approve a welcome email, then send it from the owner’s mailbox.',
    definition: {
      trigger: { event: 'contact.created', conditions: { match: 'all', rules: [{ field: 'record.email', op: 'not_empty' }] } },
      start: 'action_1',
      nodes: [
        {
          id: 'action_1',
          type: 'action',
          action: { type: 'send_email', subject: 'Great to meet you', body: 'Hi {{record.firstName}},\n\nThanks for your time. I will follow up shortly.\n' },
          next: null,
        },
      ],
    },
  },
];
