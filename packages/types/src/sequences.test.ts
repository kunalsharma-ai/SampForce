import { describe, expect, it } from 'vitest';
import { emailTemplateInputSchema, nextSendSlot, pickVariant, renderMerge, sequenceInputSchema } from './sequences';

describe('renderMerge', () => {
  it('fills fields, uses fallbacks and reports gaps', () => {
    const r = renderMerge('Hi {{ first_name | there }}, about {{company}} and {{job_title}}', { first_name: '', company: 'Acme' });
    expect(r.text).toBe('Hi there, about Acme and ');
    expect(r.missing).toEqual(['job_title']);
    expect(r.unknown).toEqual([]);
  });

  it('leaves unknown tags as typed', () => {
    const r = renderMerge('Hello {{nickname}}', {});
    expect(r.text).toBe('Hello {{nickname}}');
    expect(r.unknown).toEqual(['nickname']);
  });
});

describe('template and sequence validation', () => {
  it('rejects unknown merge fields', () => {
    const r = emailTemplateInputSchema.safeParse({ name: 'x', subject: 'Hi {{nick}}', body: 'b' });
    expect(r.success).toBe(false);
  });

  it('needs a template or content on email steps and forward-only jumps', () => {
    const bad = sequenceInputSchema.safeParse({
      name: 's',
      steps: [
        { id: 'a', type: 'email', delayDays: 0 },
        { id: 'b', type: 'condition', delayDays: 2, check: 'opened', ifYes: 'a', ifNo: 'next' },
      ],
    });
    expect(bad.success).toBe(false);
    const messages = bad.success ? [] : bad.error.issues.map((i) => i.message);
    expect(messages).toContain('Step 1: pick a template or write a subject and body');
    expect(messages).toContain('Step 2: it can only jump forward');

    const ok = sequenceInputSchema.parse({
      name: 's',
      steps: [
        { id: 'a', type: 'email', delayDays: 0, subject: 'Hi {{first_name}}', body: 'Hello' },
        { id: 'b', type: 'condition', delayDays: 3, check: 'replied', ifYes: 'stop', ifNo: 'c' },
        { id: 'c', type: 'email', delayDays: 0, subject: 'Following up', body: 'Again' },
      ],
    });
    expect(ok.rules.map((r) => r.on)).toEqual(['replied', 'bounced']);
    expect(ok.settings.sendDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects a rule that both stops and moves', () => {
    const r = sequenceInputSchema.safeParse({ name: 's', rules: [{ on: 'replied', actions: [{ type: 'stop' }, { type: 'move_sequence', sequenceId: '00000000-0000-4000-8000-000000000000' }] }] });
    expect(r.success).toBe(false);
  });
});

describe('nextSendSlot', () => {
  const win = { sendDays: [1, 2, 3, 4, 5], sendStart: '09:00', sendEnd: '17:00', timezone: 'Asia/Kolkata' };

  it('keeps a time already inside the window', () => {
    // Wed 2026-11-04 10:30 IST = 05:00Z
    expect(nextSendSlot(new Date('2026-11-04T05:00:00Z'), win).toISOString()).toBe('2026-11-04T05:00:00.000Z');
  });

  it('moves an early time to the window start', () => {
    // Wed 07:00 IST = 01:30Z → 09:00 IST = 03:30Z
    expect(nextSendSlot(new Date('2026-11-04T01:30:00Z'), win).toISOString()).toBe('2026-11-04T03:30:00.000Z');
  });

  it('skips the weekend', () => {
    // Fri 2026-11-06 18:00 IST = 12:30Z → Mon 09:00 IST = 03:30Z
    expect(nextSendSlot(new Date('2026-11-06T12:30:00Z'), win).toISOString()).toBe('2026-11-09T03:30:00.000Z');
  });

  it('handles daylight saving zones', () => {
    // US clocks go back on Sun 2026-11-01. Sat 2026-10-31 20:00 New York → Mon 09:00 EST = 14:00Z
    const ny = { ...win, timezone: 'America/New_York' };
    expect(nextSendSlot(new Date('2026-11-01T00:00:00Z'), ny).toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });
});

describe('pickVariant', () => {
  it('is stable for a run and splits runs roughly in half', () => {
    expect(pickVariant('run-1', 'e1')).toBe(pickVariant('run-1', 'e1'));
    const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const b = ids.filter((id) => pickVariant(id, 'step-1') === 'B').length;
    expect(b).toBeGreaterThan(900);
    expect(b).toBeLessThan(1100);
  });
});

describe('custom fields and workspace variables in merge tags', () => {
  it('fills custom.* and var.* tags, reports gaps and leaves other dotted tags alone', () => {
    const r = renderMerge('Hi {{first_name}}, region {{custom.region}}. Book: {{var.booking_link}} {{custom.tier|standard}} {{other.thing}}', {
      first_name: 'Ana',
      'custom.region': 'EMEA',
      'var.booking_link': '',
    });
    expect(r.text).toBe('Hi Ana, region EMEA. Book:  standard {{other.thing}}');
    expect(r.missing).toEqual(['var.booking_link']);
    expect(r.unknown).toEqual(['other.thing']);
  });

  it('accepts custom and variable tags in templates but still rejects unknown ones', () => {
    expect(emailTemplateInputSchema.safeParse({ name: 'T', subject: 'For {{custom.region}}', body: '{{var.booking_link}}' }).success).toBe(true);
    expect(emailTemplateInputSchema.safeParse({ name: 'T', subject: 'Hi {{nickname}}', body: 'x' }).success).toBe(false);
  });
});
