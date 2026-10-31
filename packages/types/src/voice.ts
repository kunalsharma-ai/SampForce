import { z } from 'zod';

// ───────────── Voice-to-CRM (enhancement feature 12) ─────────────

/** "auto" asks the speech service to detect the language. The others are passed to Deepgram as given. */
export const VOICE_LANGUAGES = [
  ['auto', 'Detect automatically'],
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['ja', 'Japanese'],
] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number][0];
const languageCodes = VOICE_LANGUAGES.map(([c]) => c) as [VoiceLanguage, ...VoiceLanguage[]];

export const VOICE_RECORD_TYPES = ['lead', 'contact', 'deal', 'company'] as const;
export type VoiceRecordType = (typeof VOICE_RECORD_TYPES)[number];

export const voiceNoteCreateSchema = z.object({
  transcript: z.string().trim().max(50_000).optional(),
  language: z.enum(languageCodes).default('auto'),
  record: z.object({ type: z.enum(VOICE_RECORD_TYPES), id: z.string().uuid() }).nullable().optional(),
});
export type VoiceNoteCreate = z.infer<typeof voiceNoteCreateSchema>;
export const voiceNoteUpdateSchema = z.object({ transcript: z.string().trim().max(50_000).optional(), language: z.enum(languageCodes).optional() });

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-02');
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 14:30');
const short = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).nullable();

/** What the AI may propose. Each is created only after the person confirms it, through the normal CRM rules. */
export const voiceActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_task'), title: short(200), dueDate: ymd.nullable(), dueTime: hm.nullable(), meeting: z.boolean() }),
  z.object({ type: z.literal('add_note'), body: short(10_000) }),
  z.object({ type: z.literal('create_lead'), name: short(200), company: opt(200), email: z.string().trim().toLowerCase().email().max(254).nullable(), phone: opt(50) }),
  z.object({ type: z.literal('create_contact'), firstName: short(100), lastName: opt(100), jobTitle: opt(150), email: z.string().trim().toLowerCase().email().max(254).nullable(), phone: opt(50) }),
]);
export type VoiceAction = z.infer<typeof voiceActionSchema>;
export type VoiceActionType = VoiceAction['type'];
export const VOICE_ACTION_LABELS: Record<VoiceActionType, string> = { create_task: 'Task', add_note: 'Note', create_lead: 'New lead', create_contact: 'New contact' };

/** What the model returns (validated again on the server). */
export const voiceInterpretationSchema = z.object({
  summary: z.string().max(2000),
  actions: z.array(voiceActionSchema).max(10),
  lastCallRequested: z.boolean(),
  unsupported: z.array(z.string().max(300)).max(10),
});
export type VoiceInterpretation = z.infer<typeof voiceInterpretationSchema>;

export interface VoiceActionState {
  action: VoiceAction;
  status: 'proposed' | 'applied' | 'skipped';
  /** Why a field was cleared on the server, e.g. an email that was not in the note. */
  warnings: string[];
  result: { type: 'task' | 'activity' | 'lead' | 'contact'; id: string; link: string } | null;
}

export interface VoiceLastCall {
  title: string;
  occurredAt: string;
  summary: string;
  link: string;
  /** "meeting_record" when an AI reading was reviewed or written; "activity" for a logged call or meeting. */
  source: 'meeting_record' | 'activity';
}

export interface VoiceNote {
  id: string;
  source: 'typed' | 'recording';
  language: VoiceLanguage;
  detectedLanguage: string | null;
  transcript: string | null;
  durationSeconds: number | null;
  transcriptionStatus: 'none' | 'processing' | 'done' | 'failed';
  transcriptionError: string | null;
  record: { type: VoiceRecordType; id: string; name: string } | null;
  summary: string | null;
  actions: VoiceActionState[];
  unsupported: string[];
  lastCall: VoiceLastCall | null;
  /** True when the note asked for the last call and none was found. */
  lastCallMissing: boolean;
  interpretedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
}

/** The actions to create: indexes of the proposed list, each with the person's edited version. */
export const voiceApplySchema = z.object({
  items: z.array(z.object({ index: z.number().int().min(0).max(9), action: voiceActionSchema })).min(1).max(10),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).default(0),
});
export type VoiceApply = z.infer<typeof voiceApplySchema>;

/** The person's own date, so "tomorrow" and "next Monday" mean their day, not the server's. */
export const voiceInterpretSchema = z.object({ today: ymd });
