import { z } from 'zod';

// ───────────── Meeting intelligence (enhancement feature 7) ─────────────

const text = (max: number) => z.string().trim().max(max);

/** One speaker turn, as the transcription service reported it. Speakers are numbered, not named. */
export interface TranscriptSegment {
  speaker: number | null;
  start: number;
  end: number;
  text: string;
}

/** The structured reading of a meeting. The AI proposes it; a person reviews and edits it. */
export const meetingAnalysisSchema = z.object({
  summary: text(4000).min(1, 'Write a summary'),
  keyPoints: z.array(text(500).min(1)).max(20),
  requirements: z.array(text(500).min(1)).max(20),
  objections: z.array(text(500).min(1)).max(20),
  decisions: z.array(text(500).min(1)).max(20),
  actionItems: z
    .array(
      z.object({
        title: text(200).min(1, 'Give the action a title'),
        owner: z.enum(['me', 'customer']),
        dueInDays: z.number().int().min(0).max(365).nullable(),
        /** Set by SampForce once a task was created from this item. */
        taskId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(20),
  commitments: z.array(z.object({ who: text(120).min(1), what: text(500).min(1) })).max(20),
  /** Who took part. `speaker` links a numbered transcript speaker to a name when that can be told. */
  participants: z.array(z.object({ name: text(120).min(1), speaker: z.number().int().min(0).max(50).nullable(), side: z.enum(['us', 'customer', 'unknown']) })).max(30),
  followUpEmail: z.object({ subject: text(200).min(1), body: text(5000).min(1) }),
});
export type MeetingAnalysis = z.infer<typeof meetingAnalysisSchema>;

export const meetingRecordCreateSchema = z
  .object({
    meetingId: z.string().uuid().optional(),
    title: text(300).min(1).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    contactId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
  })
  .refine((v) => v.meetingId || v.title, { message: 'Give the meeting a title', path: ['title'] });
export type MeetingRecordCreate = z.infer<typeof meetingRecordCreateSchema>;

export const meetingRecordUpdateSchema = z.object({
  title: text(300).min(1).optional(),
  contactId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  /** Pasted notes or a transcript. Replacing it keeps the old AI reading until "Analyse" runs again. */
  transcript: text(200_000).optional(),
  source: z.enum(['notes', 'transcript']).optional(),
  /** The reviewed reading. Saving it marks the record as reviewed by you. */
  analysis: meetingAnalysisSchema.optional(),
});
export type MeetingRecordUpdate = z.infer<typeof meetingRecordUpdateSchema>;

export const meetingTasksSchema = z.object({ indexes: z.array(z.number().int().min(0).max(19)).min(1).max(20) });

export type TranscriptionState = 'pending_configuration' | 'configured' | 'verified';

export interface TranscriptionStatus {
  provider: 'deepgram';
  /** pending_configuration: no key. configured: key set, no successful transcription yet. verified: at least one succeeded here. */
  state: TranscriptionState;
  maxUploadMb: number;
  lastSuccessAt: string | null;
}

export interface MeetingRecordRow {
  id: string;
  meetingId: string | null;
  title: string;
  occurredAt: string;
  contact: { id: string; name: string } | null;
  lead: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  source: 'notes' | 'transcript' | 'recording';
  transcriptionStatus: 'none' | 'processing' | 'done' | 'failed';
  hasAnalysis: boolean;
  reviewed: boolean;
  savedToRecord: boolean;
  taskCount: number;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface MeetingRecord extends MeetingRecordRow {
  transcript: string | null;
  segments: TranscriptSegment[] | null;
  transcriptionProvider: string | null;
  transcriptionError: string | null;
  recordingConsent: { by: { id: string; name: string } | null; at: string } | null;
  analysis: MeetingAnalysis | null;
  analysedAt: string | null;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  activityId: string | null;
  taskIds: string[];
  attendees: string[];
  joinUrl: string | null;
}
