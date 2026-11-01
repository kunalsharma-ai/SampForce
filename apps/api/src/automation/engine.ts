import {
  type ConditionGroup,
  type ConditionRule,
  EXTERNAL_ACTIONS,
  type WorkflowAction,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@dealflow/types';

/** What a condition can look at: the record as it is now, and the event that started the run. */
export interface EvalContext {
  record: Record<string, unknown> | null;
  event: Record<string, unknown>;
}

export function readPath(ctx: EvalContext, path: string): unknown {
  const [root, ...rest] = path.split('.');
  let cur: unknown = root === 'record' ? ctx.record : root === 'event' ? ctx.event : undefined;
  for (const key of rest) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function equals(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na === nb;
  return a === b;
}

export function evaluateRule(rule: ConditionRule, ctx: EvalContext): boolean {
  const actual = readPath(ctx, rule.field);
  const expected = rule.value;
  switch (rule.op) {
    case 'empty':
      return isEmpty(actual);
    case 'not_empty':
      return !isEmpty(actual);
    case 'eq':
      return Array.isArray(actual) ? actual.some((v) => equals(v, expected)) : equals(actual, expected);
    case 'neq':
      return Array.isArray(actual) ? !actual.some((v) => equals(v, expected)) : !equals(actual, expected);
    case 'contains':
      if (Array.isArray(actual)) return actual.some((v) => equals(v, expected));
      return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().includes(expected.toLowerCase());
    case 'in':
      return Array.isArray(expected) && expected.some((v) => equals(actual, v));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = asNumber(actual) ?? (typeof actual === 'string' ? Date.parse(actual) : NaN);
      const b = asNumber(expected) ?? (typeof expected === 'string' ? Date.parse(expected) : NaN);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return rule.op === 'gt' ? a > b : rule.op === 'gte' ? a >= b : rule.op === 'lt' ? a < b : a <= b;
    }
  }
}

export function evaluateGroup(group: ConditionGroup | undefined, ctx: EvalContext): boolean {
  if (!group || group.rules.length === 0) return true;
  return group.match === 'any' ? group.rules.some((r) => evaluateRule(r, ctx)) : group.rules.every((r) => evaluateRule(r, ctx));
}

export const isExternalAction = (a: WorkflowAction) => (EXTERNAL_ACTIONS as readonly string[]).includes(a.type);

const DELAY_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

export interface StepRecord {
  nodeId: string;
  nodeType: WorkflowNode['type'];
  status: 'succeeded' | 'skipped' | 'failed' | 'waiting' | 'awaiting_approval' | 'simulated';
  output: Record<string, unknown>;
  error?: string;
}

export type RunState =
  | { kind: 'completed' }
  | { kind: 'waiting'; resumeNode: string; resumeAt: Date }
  | { kind: 'awaiting_approval'; nodeId: string; title: string; reason: 'approval_step' | 'external_action'; action?: WorkflowAction }
  | { kind: 'failed'; nodeId: string; error: string };

export interface RunHandlers {
  /** Executes an action for real (or, in a simulation, describes what would happen). */
  action(node: Extract<WorkflowNode, { type: 'action' }>): Promise<Record<string, unknown>>;
  /** Reloads the record before each condition so decisions see changes made earlier in the run. */
  refresh?(): Promise<Record<string, unknown> | null>;
  /** True when this node already succeeded in an earlier attempt (crash recovery: actions are not repeated). */
  alreadyDone?(nodeId: string): boolean;
  /** Called as each step finishes, so progress is saved even if the process stops mid-run. */
  onStep?(step: StepRecord): Promise<void>;
}

export interface RunOptions {
  now: Date;
  /** Node whose approval was just granted; its external action may now run. */
  approvedNode?: string;
  /** Simulations never wait or ask: delays and approvals are reported and passed through. */
  simulate?: boolean;
  maxSteps?: number;
}

/**
 * Walks the workflow graph from `startNode` until it ends, waits, needs approval or fails. Pure
 * apart from the handlers, so the same interpreter powers live runs, resumes and simulations.
 */
export async function advance(
  def: WorkflowDefinition,
  startNode: string | null,
  ctx: EvalContext,
  handlers: RunHandlers,
  opts: RunOptions,
): Promise<{ steps: StepRecord[]; state: RunState }> {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const steps: StepRecord[] = [];
  const record = async (step: StepRecord) => {
    steps.push(step);
    await handlers.onStep?.(step);
  };
  let current = startNode;
  const limit = opts.maxSteps ?? 100;

  while (current) {
    if (steps.length >= limit) return { steps, state: { kind: 'failed', nodeId: current, error: 'Step limit reached' } };
    const node = byId.get(current);
    if (!node) return { steps, state: { kind: 'failed', nodeId: current, error: `Step "${current}" does not exist` } };

    switch (node.type) {
      case 'condition': {
        if (handlers.refresh) ctx.record = await handlers.refresh();
        const result = evaluateGroup(node.condition, ctx);
        await record({ nodeId: node.id, nodeType: node.type, status: 'succeeded', output: { result } });
        current = result ? node.onTrue : node.onFalse;
        break;
      }
      case 'delay': {
        const resumeAt = new Date(opts.now.getTime() + node.amount * DELAY_MS[node.unit]);
        if (opts.simulate) {
          await record({ nodeId: node.id, nodeType: node.type, status: 'simulated', output: { wouldWaitUntil: resumeAt.toISOString() } });
          current = node.next;
          break;
        }
        await record({ nodeId: node.id, nodeType: node.type, status: 'waiting', output: { resumeAt: resumeAt.toISOString() } });
        if (!node.next) return { steps, state: { kind: 'completed' } };
        return { steps, state: { kind: 'waiting', resumeNode: node.next, resumeAt } };
      }
      case 'approval': {
        if (opts.simulate) {
          await record({ nodeId: node.id, nodeType: node.type, status: 'simulated', output: { wouldRequestApproval: node.title, assumed: 'approved' } });
          current = node.next;
          break;
        }
        await record({ nodeId: node.id, nodeType: node.type, status: 'awaiting_approval', output: { title: node.title } });
        return { steps, state: { kind: 'awaiting_approval', nodeId: node.id, title: node.title, reason: 'approval_step' } };
      }
      case 'action': {
        if (handlers.alreadyDone?.(node.id)) {
          current = node.next;
          break;
        }
        if (isExternalAction(node.action) && !opts.simulate && opts.approvedNode !== node.id) {
          await record({ nodeId: node.id, nodeType: node.type, status: 'awaiting_approval', output: { action: node.action.type } });
          return {
            steps,
            state: {
              kind: 'awaiting_approval',
              nodeId: node.id,
              title: node.label ?? describeAction(node.action),
              reason: 'external_action',
              action: node.action,
            },
          };
        }
        try {
          const output = await handlers.action(node);
          await record({ nodeId: node.id, nodeType: node.type, status: opts.simulate ? 'simulated' : 'succeeded', output });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          await record({ nodeId: node.id, nodeType: node.type, status: 'failed', output: {}, error });
          return { steps, state: { kind: 'failed', nodeId: node.id, error } };
        }
        current = node.next;
        break;
      }
    }
  }
  return { steps, state: { kind: 'completed' } };
}

export function describeAction(a: WorkflowAction): string {
  switch (a.type) {
    case 'create_task':
      return `Create ${a.priority === 'HIGH' ? 'high-priority ' : ''}task "${a.title}"`;
    case 'stop_sequences':
      return a.mode === 'pause' ? 'Pause their sequences' : 'Stop their sequences';
    case 'enroll_in_sequence':
      return 'Add them to a sequence';
    case 'flag_email':
      return a.status === 'needs_verification' ? 'Flag their email address for checking' : `Mark their email address ${a.status}`;
    case 'add_engagement_points':
      return a.points > 0 ? `Add ${a.points} engagement points` : `Remove ${-a.points} engagement points`;
    case 'assign_owner':
      return a.mode === 'round_robin' ? `Assign owner (round robin across ${a.userIds.length})` : 'Assign owner';
    case 'update_field':
      return `Set ${a.field} to ${a.value === null ? 'empty' : String(a.value)}`;
    case 'add_tag':
      return `Add tag "${a.tag}"`;
    case 'notify':
      return `Notify: ${a.title}`;
    case 'log_note':
      return `Log note "${a.subject}"`;
    case 'send_webhook':
      return `Send record to ${safeHost(a.url)}`;
    case 'send_email':
      return `Email the record: "${a.subject}"`;
    case 'post_to_chat':
      return `Post to Slack${a.channelName ? ` #${a.channelName}` : ''}: "${a.text.length > 60 ? `${a.text.slice(0, 57)}...` : a.text}"`;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'webhook';
  }
}

/** Round robin picks the next user after the last one this workflow assigned. */
export function nextRoundRobin(userIds: string[], last: string | null | undefined): string {
  const i = last ? userIds.indexOf(last) : -1;
  return userIds[(i + 1) % userIds.length]!;
}
