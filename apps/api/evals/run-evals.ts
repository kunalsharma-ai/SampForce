import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS, TRIGGER_EVENTS, UPDATABLE_FIELDS } from '@dealflow/types';
import type { ApiEnv } from '../src/common/env';
import { CopilotTools } from '../src/ai/copilot-tools';
import { PROMPTS, SCHEMAS } from '../src/ai/prompts';
import { AnthropicProvider, type ModelProvider, textOf } from '../src/ai/provider';
import { untrusted } from '../src/ai/redact';
import { type Score, scoreCopilotTurn, scoreLeadSummary, scoreMeetingNotes, scoreWorkflowDraft } from './scorers';

/**
 * Runs the golden datasets against a model and scores them deterministically.
 *   pnpm eval            real Claude API (needs ANTHROPIC_API_KEY; costs real credits)
 *   pnpm eval --fixture  the local fixture (checks the harness only, says nothing about answer quality)
 */
const here = dirname(fileURLToPath(import.meta.url));

interface Dataset<C> {
  prompt: string;
  description: string;
  threshold: number;
  cases: (C & { id: string })[];
}

export interface SuiteResult {
  suite: string;
  promptVersion: string;
  passed: number;
  total: number;
  rate: number;
  threshold: number;
  ok: boolean;
  cases: { id: string; score: Score }[];
}

const load = <C>(name: string): Dataset<C> => JSON.parse(readFileSync(join(here, 'datasets', name), 'utf8')) as Dataset<C>;

const allPermissions = { tenantId: 't', userId: 'u', sessionId: 's', membershipId: 'm', roleKey: 'owner', permissions: [...PERMISSIONS] };
// Tool definitions do not depend on the services, so the eval only needs the schemas.
const copilotTools = new CopilotTools(null as never, null as never, null as never, null as never, null as never).toolsFor(allPermissions);

const catalog = {
  triggerEvents: Object.fromEntries(Object.entries(TRIGGER_EVENTS).map(([k, v]) => [k, `${v.label} (record type: ${v.entity})`])),
  updatableFields: UPDATABLE_FIELDS,
  leadStatuses: ['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED'],
  users: [],
};

async function structured(provider: ModelProvider, key: 'leadSummary' | 'workflowBuilder' | 'meetingNotes', input: unknown): Promise<unknown> {
  const res = await provider.generate({ system: PROMPTS[key].system, messages: [{ role: 'user', content: JSON.stringify(input) }], maxTokens: 6000, effort: 'medium', jsonSchema: SCHEMAS[key] as Record<string, unknown> });
  try {
    return JSON.parse(textOf(res.content));
  } catch {
    return null;
  }
}

function summarise(suite: string, promptVersion: string, threshold: number, cases: { id: string; score: Score }[]): SuiteResult {
  const passed = cases.filter((c) => c.score.pass).length;
  const rate = cases.length ? passed / cases.length : 0;
  return { suite, promptVersion, passed, total: cases.length, rate, threshold, ok: rate >= threshold, cases };
}

export async function runEvals(provider: ModelProvider): Promise<SuiteResult[]> {
  const results: SuiteResult[] = [];

  const cop = load<{ question: string; expectTool: string[]; expectRefusalWords?: string[] }>('copilot-tools.json');
  const copCases = [];
  for (const c of cop.cases) {
    const res = await provider.generate({ system: PROMPTS.copilot.system, messages: [{ role: 'user', content: c.question }], tools: copilotTools, maxTokens: 2000, effort: 'medium' });
    const first = res.content.find((b) => b.type === 'tool_use');
    copCases.push({ id: c.id, score: scoreCopilotTurn(first && first.type === 'tool_use' ? first.name : null, textOf(res.content), c) });
  }
  results.push(summarise('copilot-tools', PROMPTS.copilot.version, cop.threshold, copCases));

  const lead = load<{ input: unknown; forbidden?: string[] }>('lead-summary.json');
  const leadCases = [];
  for (const c of lead.cases) leadCases.push({ id: c.id, score: scoreLeadSummary(await structured(provider, 'leadSummary', c.input), c.input, c) });
  results.push(summarise('lead-summary', PROMPTS.leadSummary.version, lead.threshold, leadCases));

  const wf = load<{ description: string; expectTrigger: string; expectActions: string[]; expectCondition?: boolean; expectDelay?: boolean }>('workflow-builder.json');
  const wfCases = [];
  for (const c of wf.cases) wfCases.push({ id: c.id, score: scoreWorkflowDraft(await structured(provider, 'workflowBuilder', { description: untrusted('person', c.description), catalog }), c) });
  results.push(summarise('workflow-builder', PROMPTS.workflowBuilder.version, wf.threshold, wfCases));

  const mn = load<{ notes: string; minActionItems: number; forbiddenNumbers?: boolean; forbidden?: string[] }>('meeting-notes.json');
  const mnCases = [];
  for (const c of mn.cases) {
    const out = await structured(provider, 'meetingNotes', { meeting: null, record: { type: 'deal', name: 'Eval deal' }, notes: untrusted('meeting_notes', c.notes) });
    mnCases.push({ id: c.id, score: scoreMeetingNotes(out, c.notes, c) });
  }
  results.push(summarise('meeting-notes', PROMPTS.meetingNotes.version, mn.threshold, mnCases));
  return results;
}

async function main() {
  const useFixture = process.argv.includes('--fixture');
  let close: (() => Promise<void>) | null = null;
  let baseUrl = process.env.AI_API_BASE_URL ?? 'https://api.anthropic.com';
  let key = process.env.ANTHROPIC_API_KEY;
  if (useFixture) {
    const { createAiFixture } = await import('../test/fixtures/ai-fixture');
    const f = await createAiFixture();
    baseUrl = f.url;
    key = 'fixture';
    close = f.close;
  }
  if (!key) {
    process.stderr.write('ANTHROPIC_API_KEY is not set. Set it to run the evals against Claude, or pass --fixture to check the harness.\n');
    process.exit(2);
  }
  const env = { ANTHROPIC_API_KEY: key, AI_API_BASE_URL: baseUrl, AI_MODEL: process.env.AI_MODEL ?? 'claude-opus-5-5', AI_REQUEST_TIMEOUT_MS: 120_000, AI_SERVER_FALLBACKS: true } as ApiEnv;
  const provider = new AnthropicProvider(env);
  const results = await runEvals(provider);
  await close?.();
  const report = { ranAt: new Date().toISOString(), model: env.AI_MODEL, target: useFixture ? 'fixture' : baseUrl, results };
  mkdirSync(join(here, 'results'), { recursive: true });
  const file = join(here, 'results', `${report.ranAt.replace(/[:.]/g, '-')}${useFixture ? '-fixture' : ''}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  for (const r of results) {
    process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'} ${r.suite} (${r.promptVersion}) ${r.passed}/${r.total} (threshold ${Math.round(r.threshold * 100)}%)\n`);
    for (const c of r.cases.filter((x) => !x.score.pass)) process.stdout.write(`  - ${c.id}: ${c.score.reasons.join('; ')}\n`);
  }
  process.stdout.write(`report: ${file}\n`);
  if (!useFixture && results.some((r) => !r.ok)) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
