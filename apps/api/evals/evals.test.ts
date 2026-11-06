import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '../src/common/env';
import { AnthropicProvider } from '../src/ai/provider';
import { type AiFixture, createAiFixture, json, toolUse } from '../test/fixtures/ai-fixture';
import { runEvals } from './run-evals';
import { inventedNumbers, scoreCopilotTurn, scoreLeadSummary, scoreMeetingNotes, scoreWorkflowDraft } from './scorers';

describe('eval scorers', () => {
  it('spots numbers that were not in the input', () => {
    expect(inventedNumbers('Worth 80,000 and maybe 9999999 in 3 days', '{"estimatedValue":80000}')).toEqual(['9999999']);
  });

  it('scores Copilot tool choice and refusals', () => {
    expect(scoreCopilotTurn('list_deals', '', { expectTool: ['list_deals'] }).pass).toBe(true);
    expect(scoreCopilotTurn('export_contacts', '', { expectTool: [] }).reasons[0]).toMatch(/outside the allowlist/);
    expect(scoreCopilotTurn('propose_create_task', '', { expectTool: [] }).pass).toBe(false);
    expect(scoreCopilotTurn(null, 'Sorry, that is not something Copilot can do.', { expectTool: [], expectRefusalWords: ['not something'] }).pass).toBe(true);
  });

  it('scores structured outputs', () => {
    expect(scoreLeadSummary({ summary: 'Worth 9999999', nextStep: 'Call' }, { v: 1 }, {}).pass).toBe(false);
    expect(scoreWorkflowDraft({ definitionJson: '{"trigger":{"event":"lead.created"},"start":null,"nodes":[]}' }, { expectTrigger: 'lead.created', expectActions: ['create_task'] }).reasons).toEqual(['missing action create_task']);
    expect(scoreMeetingNotes({ summary: 's', decisions: [], actionItems: [{ title: 'Wire money' }], followUpEmail: { subject: 'a', body: 'b' } }, 'n', { minActionItems: 1, forbidden: ['wire'] }).pass).toBe(false);
  });
});

describe('eval harness (against the fixture, so this checks plumbing, not answer quality)', () => {
  let fixture: AiFixture;
  beforeAll(async () => {
    fixture = await createAiFixture();
  });
  afterAll(() => fixture.close());

  it('runs every suite and reports per-case results', async () => {
    const provider = new AnthropicProvider({ ANTHROPIC_API_KEY: 'x', AI_API_BASE_URL: fixture.url, AI_MODEL: 'claude-opus-5-5', AI_REQUEST_TIMEOUT_MS: 10_000, AI_SERVER_FALLBACKS: true } as ApiEnv);
    fixture.use((b) => {
      if (b.system?.startsWith('You are SampForce Copilot')) return /pipeline/.test(JSON.stringify(b.messages)) ? toolUse('pipeline_summary', {}) : json('I cannot do that.');
      if (b.system?.startsWith('You write short')) return json({ summary: 'Promising lead.', nextStep: 'Call them.' });
      if (b.system?.startsWith('You turn a sales rep')) return json({ summary: 's', decisions: [], actionItems: [{ title: 'Send recap', owner: 'me', dueInDays: null }, { title: 'Send DPA', owner: 'me', dueInDays: null }], followUpEmail: { subject: 'Thanks', body: 'Thanks' } });
      return json({ name: 'x', definitionJson: JSON.stringify({ trigger: { event: 'lead.created', conditions: { match: 'all', rules: [] } }, start: 'action_1', nodes: [{ id: 'action_1', type: 'action', action: { type: 'create_task', title: 'Call', assignTo: 'record_owner' }, next: null }] }), notes: '' });
    });
    const results = await runEvals(provider);
    expect(results.map((r) => r.suite)).toEqual(['copilot-tools', 'lead-summary', 'workflow-builder', 'meeting-notes']);
    expect(results.find((r) => r.suite === 'lead-summary')!.passed).toBe(3);
    expect(results.find((r) => r.suite === 'copilot-tools')!.cases.find((c) => c.id === 'pipeline')!.score.pass).toBe(true);
    expect(results.find((r) => r.suite === 'workflow-builder')!.cases.find((c) => c.id === 'won-notify')!.score.pass).toBe(false);
  });
});
