import { describe, expect, it } from 'vitest';
import { workflowDefinitionSchema } from '@dealflow/types';
import { emptyDefinition, insertAt, removeNode, TEMPLATES } from './workflow-model';

describe('workflow editor model', () => {
  it('inserts steps into the start slot and after other steps', () => {
    let d = insertAt(emptyDefinition(), { kind: 'start' }, 'action');
    d = insertAt(d, { kind: 'next', nodeId: 'action_1' }, 'delay');
    d = insertAt(d, { kind: 'next', nodeId: 'delay_1' }, 'action');
    d = insertAt(d, { kind: 'start' }, 'condition');
    expect(d.start).toBe('condition_1');
    const cond = d.nodes.find((n) => n.id === 'condition_1');
    expect(cond).toMatchObject({ onTrue: 'action_1', onFalse: null });
    expect(workflowDefinitionSchema.safeParse(d).success).toBe(true);
  });

  it('splices out linear steps and drops the "no" branch with its condition', () => {
    let d = insertAt(emptyDefinition(), { kind: 'start' }, 'action');
    d = insertAt(d, { kind: 'next', nodeId: 'action_1' }, 'condition');
    d = insertAt(d, { kind: 'onFalse', nodeId: 'condition_1' }, 'action');
    d = insertAt(d, { kind: 'onTrue', nodeId: 'condition_1' }, 'approval');
    const noCond = removeNode(d, 'condition_1');
    expect(noCond.nodes.map((n) => n.id).sort()).toEqual(['action_1', 'approval_1']);
    expect(noCond.nodes.find((n) => n.id === 'action_1')).toMatchObject({ next: 'approval_1' });
    const noFirst = removeNode(d, 'action_1');
    expect(noFirst.start).toBe('condition_1');
    expect(workflowDefinitionSchema.safeParse(noFirst).success).toBe(true);
  });

  it('ships templates that pass validation', () => {
    for (const t of TEMPLATES) expect(workflowDefinitionSchema.safeParse(t.definition).success, t.key).toBe(true);
  });
});
