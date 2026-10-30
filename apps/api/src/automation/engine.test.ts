import { describe, expect, it, vi } from 'vitest';
import { type WorkflowDefinition, workflowDefinitionSchema } from '@dealflow/types';
import { advance, evaluateGroup, evaluateRule, nextRoundRobin } from './engine';

const now = new Date('2026-10-30T12:00:00Z');
const def = (d: unknown): WorkflowDefinition => workflowDefinitionSchema.parse(d);

describe('conditions', () => {
  const ctx = { record: { status: 'NEW', estimatedValue: '25000', tags: ['vip'], email: null }, event: { to: 'Proposal' } };

  it('compares strings case-insensitively and numbers numerically', () => {
    expect(evaluateRule({ field: 'record.status', op: 'eq', value: 'new' }, ctx)).toBe(true);
    expect(evaluateRule({ field: 'record.estimatedValue', op: 'gt', value: 10000 }, ctx)).toBe(true);
    expect(evaluateRule({ field: 'record.estimatedValue', op: 'lte', value: 1000 }, ctx)).toBe(false);
  });

  it('handles arrays, membership and emptiness', () => {
    expect(evaluateRule({ field: 'record.tags', op: 'contains', value: 'VIP' }, ctx)).toBe(true);
    expect(evaluateRule({ field: 'event.to', op: 'in', value: ['Proposal', 'Negotiation'] }, ctx)).toBe(true);
    expect(evaluateRule({ field: 'record.email', op: 'empty' }, ctx)).toBe(true);
    expect(evaluateRule({ field: 'record.missing.deep', op: 'not_empty' }, ctx)).toBe(false);
  });

  it('combines rules with all / any, and an empty group matches', () => {
    const rules = [
      { field: 'record.status', op: 'eq' as const, value: 'NEW' },
      { field: 'record.status', op: 'eq' as const, value: 'LOST' },
    ];
    expect(evaluateGroup({ match: 'all', rules }, ctx)).toBe(false);
    expect(evaluateGroup({ match: 'any', rules }, ctx)).toBe(true);
    expect(evaluateGroup({ match: 'all', rules: [] }, ctx)).toBe(true);
  });
});

describe('advance', () => {
  const branching = def({
    trigger: { event: 'lead.created' },
    start: 'big',
    nodes: [
      { id: 'big', type: 'condition', condition: { match: 'all', rules: [{ field: 'record.estimatedValue', op: 'gte', value: 50000 }] }, onTrue: 'task', onFalse: 'note' },
      { id: 'task', type: 'action', action: { type: 'create_task', title: 'Call today' }, next: 'wait' },
      { id: 'wait', type: 'delay', amount: 2, unit: 'days', next: 'ping' },
      { id: 'ping', type: 'action', action: { type: 'notify', title: 'Follow up' }, next: null },
      { id: 'note', type: 'action', action: { type: 'log_note', subject: 'Small lead' }, next: null },
    ],
  });

  it('follows the true branch and stops at a delay with a resume point', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const r = await advance(branching, 'big', { record: { estimatedValue: 90000 }, event: {} }, { action }, { now });
    expect(r.steps.map((s) => s.nodeId)).toEqual(['big', 'task', 'wait']);
    expect(r.state).toEqual({ kind: 'waiting', resumeNode: 'ping', resumeAt: new Date('2026-11-01T12:00:00Z') });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('follows the false branch to completion', async () => {
    const action = vi.fn().mockResolvedValue({});
    const r = await advance(branching, 'big', { record: { estimatedValue: 100 }, event: {} }, { action }, { now });
    expect(r.steps.map((s) => s.nodeId)).toEqual(['big', 'note']);
    expect(r.state.kind).toBe('completed');
  });

  it('resumes after the delay', async () => {
    const action = vi.fn().mockResolvedValue({});
    const r = await advance(branching, 'ping', { record: {}, event: {} }, { action }, { now });
    expect(r.steps.map((s) => s.nodeId)).toEqual(['ping']);
    expect(r.state.kind).toBe('completed');
  });

  it('records a failure and stops', async () => {
    const action = vi.fn().mockRejectedValue(new Error('Owner lost access'));
    const r = await advance(branching, 'big', { record: { estimatedValue: 1 }, event: {} }, { action }, { now });
    expect(r.state).toEqual({ kind: 'failed', nodeId: 'note', error: 'Owner lost access' });
    expect(r.steps.at(-1)?.status).toBe('failed');
  });

  it('skips actions that already succeeded in an earlier attempt', async () => {
    const action = vi.fn().mockResolvedValue({});
    const r = await advance(branching, 'big', { record: { estimatedValue: 90000 }, event: {} }, { action, alreadyDone: (id) => id === 'task' }, { now });
    expect(action).not.toHaveBeenCalled();
    expect(r.state.kind).toBe('waiting');
  });

  it('re-reads the record before each condition', async () => {
    const d = def({
      trigger: { event: 'lead.created' },
      start: 'set',
      nodes: [
        { id: 'set', type: 'action', action: { type: 'update_field', field: 'status', value: 'QUALIFIED' }, next: 'check' },
        { id: 'check', type: 'condition', condition: { match: 'all', rules: [{ field: 'record.status', op: 'eq', value: 'QUALIFIED' }] }, onTrue: null, onFalse: null },
      ],
    });
    const r = await advance(d, 'set', { record: { status: 'NEW' }, event: {} }, { action: async () => ({}), refresh: async () => ({ status: 'QUALIFIED' }) }, { now });
    expect(r.steps[1]?.output).toEqual({ result: true });
  });

  describe('approvals', () => {
    const external = def({
      trigger: { event: 'deal.won' },
      start: 'gate',
      nodes: [
        { id: 'gate', type: 'approval', title: 'Manager signs off', next: 'hook', onReject: 'note' },
        { id: 'hook', type: 'action', action: { type: 'send_webhook', url: 'https://example.com/hook' }, next: null },
        { id: 'note', type: 'action', action: { type: 'log_note', subject: 'Rejected' }, next: null },
      ],
    });

    it('pauses at an approval step', async () => {
      const r = await advance(external, 'gate', { record: {}, event: {} }, { action: vi.fn() }, { now });
      expect(r.state).toMatchObject({ kind: 'awaiting_approval', nodeId: 'gate', reason: 'approval_step' });
    });

    it('always pauses before an external action, even after an approval step', async () => {
      const action = vi.fn();
      const r = await advance(external, 'hook', { record: {}, event: {} }, { action }, { now });
      expect(r.state).toMatchObject({ kind: 'awaiting_approval', nodeId: 'hook', reason: 'external_action' });
      expect(action).not.toHaveBeenCalled();
      const approved = await advance(external, 'hook', { record: {}, event: {} }, { action: vi.fn().mockResolvedValue({ status: 200 }) }, { now, approvedNode: 'hook' });
      expect(approved.state.kind).toBe('completed');
    });

    it('simulations pass through delays and approvals without running anything real', async () => {
      const action = vi.fn().mockResolvedValue({ simulated: true });
      const r = await advance(external, 'gate', { record: {}, event: {} }, { action }, { now, simulate: true });
      expect(r.steps.map((s) => [s.nodeId, s.status])).toEqual([
        ['gate', 'simulated'],
        ['hook', 'simulated'],
      ]);
      expect(r.state.kind).toBe('completed');
    });
  });
});

describe('definition validation', () => {
  it('rejects loops, missing steps and fields a workflow may not change', () => {
    const base = { trigger: { event: 'lead.created' }, start: 'a' };
    expect(
      workflowDefinitionSchema.safeParse({
        ...base,
        nodes: [
          { id: 'a', type: 'delay', amount: 1, unit: 'hours', next: 'b' },
          { id: 'b', type: 'delay', amount: 1, unit: 'hours', next: 'a' },
        ],
      }).success,
    ).toBe(false);
    expect(workflowDefinitionSchema.safeParse({ ...base, nodes: [{ id: 'a', type: 'delay', amount: 1, unit: 'hours', next: 'zzz' }] }).success).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({ ...base, nodes: [{ id: 'a', type: 'action', action: { type: 'update_field', field: 'ownerId', value: 'x' } }] }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({ ...base, nodes: [{ id: 'a', type: 'action', action: { type: 'update_field', field: 'status', value: 'QUALIFIED' } }] }).success,
    ).toBe(true);
  });
});

describe('nextRoundRobin', () => {
  it('cycles through users', () => {
    expect(nextRoundRobin(['a', 'b', 'c'], null)).toBe('a');
    expect(nextRoundRobin(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextRoundRobin(['a', 'b', 'c'], 'c')).toBe('a');
    expect(nextRoundRobin(['a', 'b'], 'gone')).toBe('a');
  });
});
