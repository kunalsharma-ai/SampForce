import { describe, expect, it } from 'vitest';
import { type JourneyFacts, journeyProgressOf, journeyStageOf, journeyStagesOf, journeySettingsSchema, journeySteps, visibleJourneyKey } from './journey';

const facts = (f: Partial<JourneyFacts>): JourneyFacts => ({ statusMeaning: 'NEW', statusName: 'New Lead', won: false, openDeal: false, openRfq: false, contactStages: [], ...f });

describe('company journey (ADR 0085)', () => {
  it('works the stage out from employees, RFQs, deals and the status', () => {
    expect(journeyStageOf(facts({}))).toBe('NEW');
    expect(journeyStageOf(facts({ contactStages: ['FRESH_EMAIL_PENDING', 'NEW_CONTACT'] }))).toBe('FRESH_EMAIL');
    expect(journeyStageOf(facts({ contactStages: ['FRESH_EMAIL_PENDING', 'INITIAL_EMAIL_SENT'] }))).toBe('INITIAL_EMAIL');
    expect(journeyStageOf(facts({ contactStages: ['FOLLOW_UP_2', 'INITIAL_EMAIL_SENT'] }))).toBe('FOLLOW_UP');
    expect(journeyStageOf(facts({ contactStages: ['FOLLOW_UP_2', 'CALL_DONE'] }))).toBe('DISCUSSION');
    expect(journeyStageOf(facts({ contactStages: ['DISCUSSION'], openRfq: true }))).toBe('RFQ');
    expect(journeyStageOf(facts({ contactStages: ['RFQ_RECEIVED'], openDeal: true }))).toBe('NEGOTIATION');
    expect(journeyStageOf(facts({ statusMeaning: 'CLIENT', statusName: 'Existing Client' }))).toBe('WON');
    expect(journeyStageOf(facts({ won: true, statusMeaning: 'ACTIVE' }))).toBe('WON');
    expect(journeyStageOf(facts({ statusMeaning: 'LOST', statusName: 'Not Interested', contactStages: ['DISCUSSION'] }))).toBe('NOT_INTERESTED');
    expect(journeyStageOf(facts({ statusMeaning: 'LOST', statusName: 'Rejected' }))).toBe('REJECTED');
    expect(journeyStageOf(facts({ statusMeaning: 'ON_HOLD', statusName: 'On Hold' }))).toBe('ON_HOLD');
    // Every employee's conversation ended: the company is lost too.
    expect(journeyStageOf(facts({ contactStages: ['RFQ_LOST', 'RFQ_REJECTED'] }))).toBe('REJECTED');
    expect(journeyStageOf(facts({ contactStages: ['RFQ_LOST', null] }))).toBe('RFQ');
    expect(journeyProgressOf(facts({ statusMeaning: 'LOST', contactStages: ['FOLLOW_UP_1'] }))).toBe('FOLLOW_UP');
  });

  it('builds the visual journey: done, current, next and pending, or the ending after the furthest step', () => {
    const stages = journeyStagesOf({});
    expect(journeySteps('FOLLOW_UP', 'FOLLOW_UP', stages).map((s) => `${s.key}:${s.state}`)).toEqual([
      'NEW:DONE', 'FRESH_EMAIL:DONE', 'INITIAL_EMAIL:DONE', 'FOLLOW_UP:CURRENT', 'DISCUSSION:NEXT', 'RFQ:PENDING', 'NEGOTIATION:PENDING', 'WON:PENDING',
    ]);
    expect(journeySteps('WON', 'WON', stages).at(-1)).toMatchObject({ key: 'WON', state: 'WON' });
    expect(journeySteps('REJECTED', 'RFQ', stages).map((s) => `${s.key}:${s.state}`)).toEqual([
      'NEW:DONE', 'FRESH_EMAIL:DONE', 'INITIAL_EMAIL:DONE', 'FOLLOW_UP:DONE', 'DISCUSSION:DONE', 'RFQ:DONE', 'REJECTED:LOST',
    ]);
    expect(journeySteps('ON_HOLD', 'DISCUSSION', stages).at(-1)).toMatchObject({ key: 'ON_HOLD', state: 'ON_HOLD' });
  });

  it('applies names, colours and hidden stages, and never hides New, RFQ, Won or Lost', () => {
    const stages = journeyStagesOf({ stages: { FOLLOW_UP: { name: 'Chasing', color: '#123456' }, DISCUSSION: { hidden: true }, WON: { hidden: true } } });
    expect(stages.find((s) => s.key === 'FOLLOW_UP')).toMatchObject({ name: 'Chasing', color: '#123456', customised: true });
    expect(stages.find((s) => s.key === 'WON')!.hidden).toBe(false);
    const hidden = new Set(stages.filter((s) => s.hidden).map((s) => s.key));
    expect(visibleJourneyKey('DISCUSSION', hidden)).toBe('FOLLOW_UP');
    expect(journeySteps('DISCUSSION', 'DISCUSSION', stages).map((s) => s.key)).not.toContain('DISCUSSION');
    expect(journeySettingsSchema.safeParse({ stages: { RFQ: { hidden: true } } }).success).toBe(false);
    expect(journeySettingsSchema.safeParse({ stages: { RFQ: { name: 'Quote asked', color: '#ABCDEF' } } }).success).toBe(true);
    expect(journeySettingsSchema.safeParse({ stages: { NOPE: {} } }).success).toBe(false);
  });
});
