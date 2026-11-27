import { z } from 'zod';

/*
 * Learning & Development (ADR 0097). Super and Manager Workspaces build learning modules out of lessons (a video
 * link, an uploaded video, audio, document, presentation, spreadsheet, image or written text) and an assessment, then
 * assign them to people below them. Everyone takes what is assigned to them, the answers are marked against the
 * answer key (written answers by the responsible manager), and passing a certificate-eligible module issues a
 * certificate with a verification code.
 *
 * Questions can always be written by hand. SampForce can also draft them, without AI, from text it could actually read:
 * a document's text, a video's captions or a pasted transcript. AI drafting is an optional extra after that. Nothing is
 * drafted from material SampForce could not read, and the manager reviews every drafted question before publishing.
 */

// ───────────── Vocabulary ─────────────

export const LEARNING_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type LearningLevel = (typeof LEARNING_LEVELS)[number];
export const LEARNING_LEVEL_LABEL: Record<LearningLevel, string> = { BEGINNER: 'Beginner', INTERMEDIATE: 'Intermediate', ADVANCED: 'Advanced' };

export const LEARNING_MODULE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type LearningModuleStatus = (typeof LEARNING_MODULE_STATUSES)[number];
export const LEARNING_MODULE_STATUS_LABEL: Record<LearningModuleStatus, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' };

/** Who can find a published module: only the people it is assigned to, or anyone in the creator's part of the organisation. */
export const LEARNING_VISIBILITIES = ['ASSIGNED', 'OPEN'] as const;
export type LearningVisibility = (typeof LEARNING_VISIBILITIES)[number];

export const LESSON_KINDS = ['VIDEO', 'AUDIO', 'DOCUMENT', 'PRESENTATION', 'SPREADSHEET', 'IMAGE', 'TEXT', 'FILE'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];
export const LESSON_KIND_LABEL: Record<LessonKind, string> = {
  VIDEO: 'Video',
  AUDIO: 'Audio',
  DOCUMENT: 'Document',
  PRESENTATION: 'Presentation',
  SPREADSHEET: 'Spreadsheet',
  IMAGE: 'Image',
  TEXT: 'Written lesson',
  FILE: 'File',
};

/** What the module's material is, worked out from its lessons. */
export type LearningMaterialType = 'VIDEO' | 'DOCUMENT' | 'PRESENTATION' | 'AUDIO' | 'TEXT' | 'MIXED' | 'NONE';
export const LEARNING_MATERIAL_LABEL: Record<LearningMaterialType, string> = {
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  PRESENTATION: 'Presentation',
  AUDIO: 'Audio',
  TEXT: 'Text',
  MIXED: 'Mixed content',
  NONE: 'No material yet',
};

export const VIDEO_PROVIDERS = ['YOUTUBE', 'VIMEO', 'LOOM', 'WISTIA', 'DAILYMOTION', 'FILE_LINK'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
export const VIDEO_PROVIDER_LABEL: Record<VideoProvider, string> = {
  YOUTUBE: 'YouTube',
  VIMEO: 'Vimeo',
  LOOM: 'Loom',
  WISTIA: 'Wistia',
  DAILYMOTION: 'Dailymotion',
  FILE_LINK: 'Video file link',
};

/**
 * Whether SampForce could read a lesson's text (for questions and the reading view). UNREADABLE is said plainly to the
 * manager with the reason, and nothing is drafted from it.
 */
export const LESSON_TEXT_STATUSES = ['NONE', 'READY', 'UNREADABLE'] as const;
export type LessonTextStatus = (typeof LESSON_TEXT_STATUSES)[number];
/** Where the readable text came from. */
export const LESSON_TEXT_SOURCES = ['DOCUMENT', 'OCR', 'CAPTIONS', 'TRANSCRIPT', 'WRITTEN'] as const;
export type LessonTextSource = (typeof LESSON_TEXT_SOURCES)[number];
export const LESSON_TEXT_SOURCE_LABEL: Record<LessonTextSource, string> = {
  DOCUMENT: 'Text read from the file',
  OCR: 'Text recognised in the scanned pages or image',
  CAPTIONS: 'Video captions',
  TRANSCRIPT: 'Transcript pasted by the manager',
  WRITTEN: 'Written lesson',
};

export const QUESTION_TYPES = ['MCQ', 'MULTI', 'TRUE_FALSE', 'FILL_BLANK', 'MATCHING', 'SHORT', 'LONG', 'SCENARIO', 'PRACTICAL', 'FILE_UPLOAD'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  MCQ: 'Multiple choice',
  MULTI: 'Multiple select',
  TRUE_FALSE: 'True or false',
  FILL_BLANK: 'Fill in the blanks',
  MATCHING: 'Matching',
  SHORT: 'Short answer',
  LONG: 'Long answer',
  SCENARIO: 'Scenario',
  PRACTICAL: 'Practical assignment',
  FILE_UPLOAD: 'File upload',
};
/** Types SampForce can draft from readable text without AI. */
export const GENERATABLE_TYPES = ['MCQ', 'MULTI', 'TRUE_FALSE', 'FILL_BLANK', 'MATCHING'] as const satisfies readonly QuestionType[];
export type GeneratableType = (typeof GENERATABLE_TYPES)[number];

export const QUESTION_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];
export const QUESTION_DIFFICULTY_LABEL: Record<QuestionDifficulty, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' };

/** How a question came to be: written by hand, drafted from the material by rules, copied from the bank, or drafted by AI. */
export const QUESTION_SOURCES = ['MANUAL', 'GENERATED', 'BANK', 'AI'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

/** The blank marker in a fill-in-the-blanks question: each one is a blank, in order. */
export const BLANK = '_____';

export const ASSIGNMENT_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_MARKING', 'COMPLETED', 'FAILED'] as const;
export type LearningAssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const ASSIGNMENT_STATUS_LABEL: Record<LearningAssignmentStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  AWAITING_MARKING: 'Awaiting marking',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export const ATTEMPT_STATUSES = ['IN_PROGRESS', 'AWAITING_MARKING', 'MARKED'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const CERTIFICATE_TEMPLATES = ['CLASSIC', 'MODERN', 'EXECUTIVE'] as const;
export type CertificateTemplate = (typeof CERTIFICATE_TEMPLATES)[number];
export const CERTIFICATE_TEMPLATE_LABEL: Record<CertificateTemplate, string> = { CLASSIC: 'Classic', MODERN: 'Modern', EXECUTIVE: 'Executive' };

export const DEFAULT_LEARNING_CATEGORIES = ['Sales', 'Communication', 'Research', 'Technology', 'HR', 'Finance', 'Compliance', 'Leadership', 'Product'] as const;

/** Uploads: video and audio up to 500 MB, everything else up to 50 MB, sent in parts of this size. */
export const LEARNING_MEDIA_MAX_BYTES = 500 * 1024 * 1024;
export const LEARNING_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const LEARNING_UPLOAD_PART_BYTES = 960 * 1024;
/** Text kept from one lesson for the reading view and question drafting. */
export const LESSON_TEXT_MAX_CHARS = 400_000;
/** Less readable text than this is too little to draft questions from. */
export const MIN_TEXT_FOR_QUESTIONS = 200;

// ───────────── Inputs ─────────────

const title = z.string().trim().min(3, 'Give it a title of at least 3 characters').max(160);
const longText = (max: number) => z.string().trim().max(max);
const iso = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

export const learningModuleInputSchema = z
  .object({
    title,
    categoryId: uuid.nullable().optional(),
    description: longText(4000).optional(),
    objectives: z.array(z.string().trim().min(2).max(300)).max(20).optional(),
    keyPoints: z.array(z.string().trim().min(2).max(400)).max(30).optional(),
    instructions: longText(2000).optional(),
    level: z.enum(LEARNING_LEVELS).optional(),
    /** Overrides the estimate worked out from the lessons and questions. */
    estimatedMinutes: z.number().int().min(1).max(10_000).nullable().optional(),
    mandatory: z.boolean().optional(),
    visibility: z.enum(LEARNING_VISIBILITIES).optional(),
    passingScore: z.number().int().min(1).max(100).optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    timeLimitMinutes: z.number().int().min(1).max(600).nullable().optional(),
    /** A fixed deadline for everyone, or days after each person is assigned. */
    dueAt: iso.nullable().optional(),
    dueInDays: z.number().int().min(1).max(365).nullable().optional(),
    certificate: z.boolean().optional(),
    /** Show the right answers and explanations on the result page. */
    showAnswers: z.boolean().optional(),
    shuffleQuestions: z.boolean().optional(),
    /** The responsible manager: marks written answers and hears about submissions and completions. */
    responsibleUserId: uuid.nullable().optional(),
    /** Reminder days before the deadline (for example 3 and 1), on the day, and how often after it. */
    reminderDaysBefore: z.array(z.number().int().min(1).max(60)).max(5).optional(),
    remindOnDueDay: z.boolean().optional(),
    overdueEveryDays: z.number().int().min(1).max(30).nullable().optional(),
  })
  .strict();
export type LearningModuleInput = z.infer<typeof learningModuleInputSchema>;
export const learningModuleUpdateSchema = learningModuleInputSchema.partial().strict().refine((v) => Object.keys(v).length > 0, 'Change at least one thing');
export type LearningModuleUpdate = z.infer<typeof learningModuleUpdateSchema>;

export const lessonInputSchema = z
  .object({
    title,
    kind: z.enum(LESSON_KINDS),
    /** Written lessons: the text (plain text with blank lines between paragraphs; "# " starts a heading). */
    body: longText(100_000).optional(),
    videoUrl: z.string().trim().url('Paste the full link, starting with https://').max(1000).nullable().optional(),
    fileId: uuid.nullable().optional(),
    /** Captions (WebVTT or SRT) uploaded for an uploaded video or audio. */
    captionsFileId: uuid.nullable().optional(),
    /** A transcript or notes the manager pastes when the video's captions cannot be read. */
    transcript: longText(200_000).nullable().optional(),
    objectives: z.array(z.string().trim().min(2).max(300)).max(10).optional(),
    minutes: z.number().int().min(1).max(1000).nullable().optional(),
    required: z.boolean().optional(),
    allowDownload: z.boolean().optional(),
  })
  .strict();
export type LessonInput = z.infer<typeof lessonInputSchema>;
export const lessonUpdateSchema = lessonInputSchema.partial().strict().refine((v) => Object.keys(v).length > 0, 'Change at least one thing');
export type LessonUpdate = z.infer<typeof lessonUpdateSchema>;

export const learningReorderSchema = z.object({ ids: z.array(uuid).min(1).max(500) }).strict();
export type LearningReorderInput = z.infer<typeof learningReorderSchema>;

const optionSchema = z.object({ id: z.string().trim().min(1).max(40), text: z.string().trim().min(1, 'Every option needs text').max(500) }).strict();
const pairSchema = z.object({ id: z.string().trim().min(1).max(40), left: z.string().trim().min(1).max(300), right: z.string().trim().min(1).max(300) }).strict();

export const questionInputSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    text: z.string().trim().min(3, 'Write the question').max(4000),
    instructions: longText(1000).optional(),
    /** MCQ, MULTI and SCENARIO (optional for a scenario): the choices. */
    options: z.array(optionSchema).max(10).optional(),
    /** MCQ, MULTI, SCENARIO with options: the right option ids. */
    correctOptionIds: z.array(z.string().max(40)).max(10).optional(),
    /** TRUE_FALSE: the right answer. */
    correctBoolean: z.boolean().optional(),
    /** FILL_BLANK: for each blank in the text, the answers accepted (case and extra spaces do not matter). */
    blanks: z.array(z.array(z.string().trim().min(1).max(200)).min(1).max(10)).max(10).optional(),
    /** MATCHING: the pairs, each left item with its right match. */
    pairs: z.array(pairSchema).max(10).optional(),
    /** SHORT: answers marked right automatically; without any, a manager marks it. */
    acceptedAnswers: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
    /** LONG, SCENARIO without options, PRACTICAL, FILE_UPLOAD: what the marker looks for. */
    rubric: longText(2000).optional(),
    marks: z.number().min(0.5).max(100).optional(),
    difficulty: z.enum(QUESTION_DIFFICULTIES).optional(),
    explanation: longText(2000).optional(),
    required: z.boolean().optional(),
    lessonId: uuid.nullable().optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
    const ids = new Set((q.options ?? []).map((o) => o.id));
    if (q.type === 'MCQ' || q.type === 'MULTI') {
      if ((q.options?.length ?? 0) < 2) issue('Give at least two options', 'options');
      const right = (q.correctOptionIds ?? []).filter((id) => ids.has(id));
      if (q.type === 'MCQ' && right.length !== 1) issue('Mark exactly one option as right', 'correctOptionIds');
      if (q.type === 'MULTI' && right.length < 1) issue('Mark at least one option as right', 'correctOptionIds');
    }
    if (q.type === 'SCENARIO' && q.options?.length) {
      if (q.options.length < 2) issue('Give at least two options', 'options');
      if ((q.correctOptionIds ?? []).filter((id) => ids.has(id)).length !== 1) issue('Mark exactly one option as right', 'correctOptionIds');
    }
    if (q.type === 'TRUE_FALSE' && q.correctBoolean === undefined) issue('Say whether the statement is true or false', 'correctBoolean');
    if (q.type === 'FILL_BLANK') {
      const count = q.text.split(BLANK).length - 1;
      if (count < 1) issue(`Put ${BLANK} in the question where each blank goes`, 'text');
      else if ((q.blanks?.length ?? 0) !== count) issue('Give the accepted answers for every blank', 'blanks');
    }
    if (q.type === 'MATCHING' && (q.pairs?.length ?? 0) < 2) issue('Give at least two pairs to match', 'pairs');
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

/** Draft questions from readable lesson text, without AI. */
export const generateQuestionsSchema = z
  .object({
    /** Lessons to read; omitted = every lesson with readable text. */
    lessonIds: z.array(uuid).max(100).optional(),
    types: z.array(z.enum(GENERATABLE_TYPES)).min(1).max(GENERATABLE_TYPES.length).optional(),
    count: z.number().int().min(1).max(40).optional(),
    difficulty: z.enum(QUESTION_DIFFICULTIES).optional(),
    /** Different questions from the same text (another selection of sentences). */
    variant: z.number().int().min(0).max(1000).optional(),
    /** Also fill the module's key learning points, objectives and estimate when they are empty. */
    fillSummary: z.boolean().optional(),
  })
  .strict();
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;

/** The optional AI draft: only after the rules, through the AI providers set up in the Console (Ollama included). */
export const aiDraftQuestionsSchema = z
  .object({
    lessonIds: z.array(uuid).max(100).optional(),
    count: z.number().int().min(1).max(20).optional(),
    types: z.array(z.enum(['MCQ', 'MULTI', 'TRUE_FALSE', 'SHORT', 'SCENARIO'])).min(1).max(5).optional(),
  })
  .strict();
export type AiDraftQuestionsInput = z.infer<typeof aiDraftQuestionsSchema>;

export const questionReviewSchema = z.object({ ids: z.array(uuid).min(1).max(500), approve: z.boolean() }).strict();
export type QuestionReviewInput = z.infer<typeof questionReviewSchema>;

export const bankCopySchema = z.object({ questionIds: z.array(uuid).min(1).max(100) }).strict();
export type BankCopyInput = z.infer<typeof bankCopySchema>;

export const videoInspectSchema = z.object({ url: z.string().trim().min(8).max(1000) }).strict();
export type VideoInspectInput = z.infer<typeof videoInspectSchema>;

export const assignModuleSchema = z
  .object({
    userIds: z.array(uuid).max(500).optional(),
    /** Everyone in these workspaces (and only those workspaces). */
    workspaceIds: z.array(z.string().min(1).max(80)).max(200).optional(),
    /** Everyone at these levels the caller can assign to. */
    levels: z.array(z.enum(['SUPER', 'MANAGER', 'EXECUTIVE'])).max(3).optional(),
    dueAt: iso.nullable().optional(),
    mandatory: z.boolean().optional(),
    note: longText(500).optional(),
  })
  .strict()
  .refine((v) => (v.userIds?.length ?? 0) + (v.workspaceIds?.length ?? 0) + (v.levels?.length ?? 0) > 0, 'Choose who to assign it to');
export type AssignModuleInput = z.infer<typeof assignModuleSchema>;

export const assignmentUpdateSchema = z
  .object({
    dueAt: iso.nullable().optional(),
    mandatory: z.boolean().optional(),
    /** More attempts on top of the module's maximum (after a fail). */
    extraAttempts: z.number().int().min(0).max(20).optional(),
    note: longText(500).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one thing');
export type AssignmentUpdateInput = z.infer<typeof assignmentUpdateSchema>;

export const lessonProgressSchema = z
  .object({
    /** How far through the lesson (0-100), from the player or the page scroll. */
    percent: z.number().min(0).max(100).optional(),
    /** Where the video or audio was, to resume there. */
    positionSeconds: z.number().min(0).max(1_000_000).optional(),
    /** Seconds spent since the last report (at most 10 minutes per report). */
    seconds: z.number().int().min(0).max(600).optional(),
    done: z.boolean().optional(),
  })
  .strict();
export type LessonProgressInput = z.infer<typeof lessonProgressSchema>;

export const learningNoteSchema = z
  .object({
    lessonId: uuid.nullable().optional(),
    body: longText(5000).optional(),
    bookmark: z.boolean().optional(),
    positionSeconds: z.number().min(0).max(1_000_000).nullable().optional(),
  })
  .strict()
  .refine((v) => !!v.body || v.bookmark, 'Write a note or add a bookmark');
export type LearningNoteInput = z.infer<typeof learningNoteSchema>;

/** One answer. Which field is used depends on the question type. */
export const answerSchema = z
  .object({
    optionIds: z.array(z.string().max(40)).max(10).optional(),
    value: z.boolean().optional(),
    blanks: z.array(z.string().max(300)).max(10).optional(),
    /** MATCHING: left item id -> right item id. */
    pairs: z.record(z.string().max(40), z.string().max(40)).optional(),
    text: z.string().max(20_000).optional(),
    fileId: uuid.optional(),
  })
  .strict();
export type AnswerInput = z.infer<typeof answerSchema>;
export const saveAnswersSchema = z.object({ answers: z.record(uuid, answerSchema) }).strict();
export type SaveAnswersInput = z.infer<typeof saveAnswersSchema>;

export const markAttemptSchema = z
  .object({
    marks: z.array(z.object({ questionId: uuid, marks: z.number().min(0).max(100), feedback: longText(2000).optional() }).strict()).max(200),
    feedback: longText(4000).optional(),
  })
  .strict();
export type MarkAttemptInput = z.infer<typeof markAttemptSchema>;

export const learningCategoryInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Give the category a name').max(60),
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2563eb').optional(),
  })
  .strict();
export type LearningCategoryInput = z.infer<typeof learningCategoryInputSchema>;

export const learningSettingsSchema = z
  .object({
    issuerName: z.string().trim().min(2).max(120).optional(),
    signatoryName: z.string().trim().max(120).optional(),
    signatoryTitle: z.string().trim().max(120).optional(),
    template: z.enum(CERTIFICATE_TEMPLATES).optional(),
    accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2563eb').optional(),
    defaultPassingScore: z.number().int().min(1).max(100).optional(),
    defaultMaxAttempts: z.number().int().min(1).max(20).optional(),
    reminderDaysBefore: z.array(z.number().int().min(1).max(60)).max(5).optional(),
    remindOnDueDay: z.boolean().optional(),
    overdueEveryDays: z.number().int().min(1).max(30).nullable().optional(),
    /** Managers may create modules (on) or only assign the Super Workspace's modules (off). */
    managersCreate: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one thing');
export type LearningSettingsInput = z.infer<typeof learningSettingsSchema>;

export const learningReportQuerySchema = z
  .object({
    userId: uuid.optional(),
    managerId: uuid.optional(),
    workspaceId: z.string().min(1).max(80).optional(),
    categoryId: uuid.optional(),
    moduleId: uuid.optional(),
    status: z.enum([...ASSIGNMENT_STATUSES, 'OVERDUE']).optional(),
    result: z.enum(['PASSED', 'FAILED', 'PENDING']).optional(),
    from: iso.optional(),
    to: iso.optional(),
  })
  .strict();
export type LearningReportQuery = z.infer<typeof learningReportQuerySchema>;

export const myLearningQuerySchema = z
  .object({
    categoryId: uuid.optional(),
    from: iso.optional(),
    to: iso.optional(),
  })
  .strict();
export type MyLearningQuery = z.infer<typeof myLearningQuerySchema>;

// ───────────── Views ─────────────

export interface LearningCategoryRow {
  id: string;
  name: string;
  color: string;
  modules: number;
}

export interface LearningPersonRef {
  id: string;
  name: string;
}

export interface VideoInfo {
  url: string;
  provider: VideoProvider;
  videoId: string | null;
  /** The address the player embeds, or the file itself for a file link. */
  embedUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  author: string | null;
  /** Whether SampForce found captions it can read for questions. */
  captions: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
  /** Said to the manager when the captions could not be read, or the video details could not be fetched. */
  note: string | null;
}

export interface LearningFileRef {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** Shown inside the page (video, audio, image, PDF), as opposed to download only. */
  viewable: boolean;
}

export interface LessonView {
  id: string;
  position: number;
  title: string;
  kind: LessonKind;
  body: string | null;
  video: VideoInfo | null;
  file: LearningFileRef | null;
  captionsFile: LearningFileRef | null;
  objectives: string[];
  minutes: number;
  required: boolean;
  allowDownload: boolean;
  text: {
    status: LessonTextStatus;
    source: LessonTextSource | null;
    /** Characters of readable text. */
    chars: number;
    /** Pages, slides or sheets read. */
    parts: number | null;
    /** Why it could not be read, or what was read, in a sentence. */
    note: string | null;
  };
}

/** A question as its author sees it, answers included. */
export interface QuestionView {
  id: string;
  position: number;
  type: QuestionType;
  text: string;
  instructions: string | null;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  correctBoolean: boolean | null;
  blanks: string[][];
  pairs: { id: string; left: string; right: string }[];
  acceptedAnswers: string[];
  rubric: string | null;
  marks: number;
  difficulty: QuestionDifficulty;
  explanation: string | null;
  required: boolean;
  lessonId: string | null;
  source: QuestionSource;
  /** The sentence of the material a drafted question was made from. */
  sourceExcerpt: string | null;
  /** Drafted questions wait for the manager's approval; only approved questions are in the assessment. */
  approved: boolean;
  /** Marked by a person rather than the answer key. */
  manual: boolean;
}

export interface LearningModuleRow {
  id: string;
  /** The module ID people see, like LRN-0007. */
  number: string;
  title: string;
  category: { id: string; name: string; color: string } | null;
  level: LearningLevel;
  materialType: LearningMaterialType;
  status: LearningModuleStatus;
  mandatory: boolean;
  visibility: LearningVisibility;
  estimatedMinutes: number;
  lessons: number;
  questions: number;
  /** Drafted questions not approved yet. */
  pendingQuestions: number;
  totalMarks: number;
  passingScore: number;
  maxAttempts: number;
  certificate: boolean;
  dueAt: string | null;
  dueInDays: number | null;
  createdBy: LearningPersonRef | null;
  responsible: LearningPersonRef | null;
  /** The workspace that owns it (Super or a Manager Workspace). */
  ownerWorkspace: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  stats: { assigned: number; started: number; completed: number; failed: number; overdue: number; averageScore: number | null };
  /** Whether the caller may change it (the Super Workspace, or the manager who owns it). */
  canEdit: boolean;
}

export interface ModuleHistoryRow {
  id: string;
  at: string;
  actor: LearningPersonRef | null;
  kind: string;
  summary: string;
}

export interface LearningModuleDetail extends LearningModuleRow {
  description: string | null;
  objectives: string[];
  keyPoints: string[];
  instructions: string | null;
  timeLimitMinutes: number | null;
  showAnswers: boolean;
  shuffleQuestions: boolean;
  reminderDaysBefore: number[];
  remindOnDueDay: boolean;
  overdueEveryDays: number | null;
  lessonList: LessonView[];
  questionList: QuestionView[];
  history: ModuleHistoryRow[];
  /** Whether an AI provider is set up, so the optional AI draft can be offered. */
  aiAvailable: boolean;
  /** What is still missing before it can be published. */
  publishProblems: string[];
}

export interface AssigneeOption {
  id: string;
  name: string;
  workspaceId: string;
  workspace: string;
  level: 'SUPER' | 'MANAGER' | 'EXECUTIVE';
}

export interface AssignmentRow {
  id: string;
  moduleId: string;
  moduleNumber: string;
  moduleTitle: string;
  user: LearningPersonRef & { workspace: string | null; level: 'SUPER' | 'MANAGER' | 'EXECUTIVE' };
  assignedBy: LearningPersonRef | null;
  assignedAt: string;
  dueAt: string | null;
  mandatory: boolean;
  status: LearningAssignmentStatus;
  overdue: boolean;
  progress: number;
  attemptsUsed: number;
  attemptsAllowed: number;
  bestScore: number | null;
  lastScore: number | null;
  passed: boolean | null;
  completedAt: string | null;
  certificateId: string | null;
  minutesSpent: number;
}

/** A learner's card on the Learning dashboard. */
export interface LearningCard {
  moduleId: string;
  assignmentId: string | null;
  number: string;
  title: string;
  description: string | null;
  category: { id: string; name: string; color: string } | null;
  level: LearningLevel;
  materialType: LearningMaterialType;
  estimatedMinutes: number;
  lessons: number;
  questions: number;
  mandatory: boolean;
  assignedAt: string | null;
  dueAt: string | null;
  status: LearningAssignmentStatus;
  overdue: boolean;
  /** New: assigned or published in the last 7 days and not opened yet. */
  isNew: boolean;
  progress: number;
  bestScore: number | null;
  passingScore: number;
  attemptsUsed: number;
  attemptsAllowed: number;
  certificate: boolean;
  certificateId: string | null;
  thumbnailUrl: string | null;
}

export interface LearningStats {
  assigned: number;
  completed: number;
  inProgress: number;
  pending: number;
  overdue: number;
  awaitingMarking: number;
  assignmentsCompleted: number;
  totalMarks: number;
  maxMarks: number;
  averageScore: number | null;
  highestScore: number | null;
  certificates: number;
  learningMinutes: number;
  /** Days in a row (to today or yesterday) with learning activity. */
  streakDays: number;
  completionPercent: number;
}

export interface MyLearningView {
  stats: LearningStats;
  cards: LearningCard[];
  /** Published OPEN modules the person has not started: optional training to explore. */
  explore: LearningCard[];
  upcoming: { moduleId: string; title: string; dueAt: string; overdue: boolean }[];
  results: { attemptId: string; moduleId: string; title: string; percent: number | null; passed: boolean | null; status: AttemptStatus; submittedAt: string }[];
  certificates: CertificateRow[];
  /** Scores over time, oldest first, for the chart. */
  scoreHistory: { at: string; percent: number; title: string }[];
  byCategory: { category: string; color: string; assigned: number; completed: number; averageScore: number | null }[];
  canManage: boolean;
}

/** A question as a learner sees it: no answers. */
export interface LearnerQuestion {
  id: string;
  position: number;
  type: QuestionType;
  text: string;
  instructions: string | null;
  options: { id: string; text: string }[];
  /** MATCHING: the left items, and the right items in shuffled order. */
  left: { id: string; text: string }[];
  right: { id: string; text: string }[];
  blanks: number;
  marks: number;
  required: boolean;
  manual: boolean;
}

export interface QuestionResult {
  questionId: string;
  marks: number | null;
  maxMarks: number;
  /** null while it waits for a person to mark it. */
  correct: boolean | null;
  feedback: string | null;
  /** Shown when the module shows answers. */
  correctAnswer: string | null;
  explanation: string | null;
}

export interface AttemptView {
  id: string;
  number: number;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  expiresAt: string | null;
  answers: Record<string, AnswerInput>;
  questions: LearnerQuestion[];
  score: number | null;
  /** Marks already given while written answers wait. */
  autoScore: number;
  maxScore: number;
  percent: number | null;
  passed: boolean | null;
  results: QuestionResult[] | null;
  feedback: string | null;
  markedBy: LearningPersonRef | null;
  markedAt: string | null;
  /** Lesson titles of the questions answered wrongly: what to look at again. */
  improve: string[];
}

export interface PlayerView {
  module: {
    id: string;
    number: string;
    title: string;
    description: string | null;
    objectives: string[];
    keyPoints: string[];
    instructions: string | null;
    category: { id: string; name: string; color: string } | null;
    level: LearningLevel;
    estimatedMinutes: number;
    passingScore: number;
    maxAttempts: number;
    timeLimitMinutes: number | null;
    certificate: boolean;
    totalMarks: number;
    questions: number;
    status: LearningModuleStatus;
  };
  lessons: (LessonView & { done: boolean; percent: number; positionSeconds: number | null })[];
  assignment: AssignmentRow | null;
  /** Whether the person may open the assessment now (every required lesson done, attempts left). */
  canAttempt: boolean;
  attemptBlockedReason: string | null;
  openAttemptId: string | null;
  attempts: { id: string; number: number; status: AttemptStatus; percent: number | null; passed: boolean | null; submittedAt: string | null }[];
  notes: LearningNoteRow[];
  certificate: CertificateRow | null;
  lastLessonId: string | null;
  /** The person opened a module that is not assigned to them (an OPEN module): starting it enrols them. */
  preview: boolean;
  requirements: { lessons: number; lessonsDone: number; assessment: boolean; passingScore: number };
}

export interface LearningNoteRow {
  id: string;
  lessonId: string | null;
  lessonTitle: string | null;
  body: string | null;
  bookmark: boolean;
  positionSeconds: number | null;
  createdAt: string;
}

export interface CertificateRow {
  id: string;
  number: string;
  code: string;
  recipientName: string;
  userId: string;
  moduleId: string;
  moduleTitle: string;
  category: string | null;
  score: number;
  completedAt: string;
  issuedAt: string;
  issuerName: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
  template: CertificateTemplate;
  accentColor: string;
  revoked: boolean;
}

export interface CertificateVerification {
  valid: boolean;
  /** Only for a valid code: enough to confirm the certificate, nothing more. */
  number?: string;
  recipientName?: string;
  moduleTitle?: string;
  score?: number;
  completedAt?: string;
  issuerName?: string;
  revoked?: boolean;
}

export interface MarkingRow {
  attemptId: string;
  moduleId: string;
  moduleTitle: string;
  user: LearningPersonRef;
  submittedAt: string;
  number: number;
  questions: number;
  autoScore: number;
  maxScore: number;
}

export interface MarkingDetail {
  attempt: AttemptView;
  user: LearningPersonRef;
  module: { id: string; title: string; passingScore: number };
  /** The full questions with the answer key and rubric for the marker. */
  questions: QuestionView[];
  files: Record<string, LearningFileRef>;
}

export interface LearningManageView {
  stats: {
    modules: number;
    published: number;
    drafts: number;
    archived: number;
    assignedPeople: number;
    started: number;
    completed: number;
    pending: number;
    failed: number;
    passed: number;
    overdue: number;
    awaitingMarking: number;
    averageScore: number | null;
    completionPercent: number;
    certificates: number;
  };
  modules: LearningModuleRow[];
  people: {
    user: LearningPersonRef & { workspace: string | null; level: 'SUPER' | 'MANAGER' | 'EXECUTIVE' };
    assigned: number;
    completed: number;
    overdue: number;
    failed: number;
    averageScore: number | null;
    certificates: number;
    minutes: number;
  }[];
  byCategory: { category: string; color: string; modules: number; completionPercent: number; averageScore: number | null }[];
  byWorkspace: { workspace: string; level: 'SUPER' | 'MANAGER' | 'EXECUTIVE'; people: number; completionPercent: number; averageScore: number | null; overdue: number }[];
  marking: number;
  level: 'SUPER' | 'MANAGER';
  canCreate: boolean;
  canConfigure: boolean;
}

export interface LearningSettingsView {
  issuerName: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
  template: CertificateTemplate;
  accentColor: string;
  defaultPassingScore: number;
  defaultMaxAttempts: number;
  reminderDaysBefore: number[];
  remindOnDueDay: boolean;
  overdueEveryDays: number | null;
  managersCreate: boolean;
}

export interface GenerateResult {
  created: QuestionView[];
  /** Lessons that could not be used, each with the plain reason. */
  skipped: { lessonId: string; title: string; reason: string }[];
  /** Fewer questions than asked for, and why. */
  note: string | null;
  summaryFilled: boolean;
}

export interface ExtractResult {
  lesson: LessonView;
}

// ───────────── Shared helpers ─────────────

/** Compares typed answers the way the answer key means them: case, accents, punctuation at the ends and repeated spaces do not count. */
export function normaliseAnswer(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[\s"'.,;:!?()[\]-]+|[\s"'.,;:!?()[\]-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Questions a person marks: written answers, practical work and uploads, and short answers without an accepted answer. */
export function isManualQuestion(q: { type: QuestionType; acceptedAnswers?: readonly string[] | null; options?: readonly unknown[] | null }): boolean {
  if (q.type === 'LONG' || q.type === 'PRACTICAL' || q.type === 'FILE_UPLOAD') return true;
  if (q.type === 'SCENARIO') return !(q.options?.length);
  if (q.type === 'SHORT') return !(q.acceptedAnswers?.length);
  return false;
}

/** The module ID shown to people. */
export const learningModuleNumber = (n: number) => `LRN-${String(n).padStart(4, '0')}`;

/** Kinds of uploaded file shown inside the page rather than only downloaded. */
export function viewableContentType(contentType: string): boolean {
  return /^(video|audio|image)\//.test(contentType) || contentType === 'application/pdf';
}

/** Reads a pasted video link: which provider it is and the address its player embeds. Null for a link that is not a video. */
export function parseVideoUrl(raw: string): { provider: VideoProvider; videoId: string | null; embedUrl: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  const url = u.toString();
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
    else if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname);
      id = m?.[1] ?? null;
    }
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    const start = Number(u.searchParams.get('t')?.replace(/s$/, '') ?? u.searchParams.get('start') ?? 0);
    return { provider: 'YOUTUBE', videoId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0${start > 0 ? `&start=${Math.floor(start)}` : ''}`, url };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /\/(?:video\/)?(\d{5,12})(?:\/([0-9a-f]{6,20}))?/.exec(u.pathname);
    if (!m) return null;
    const hash = m[2] ?? u.searchParams.get('h');
    return { provider: 'VIMEO', videoId: m[1]!, embedUrl: `https://player.vimeo.com/video/${m[1]}${hash ? `?h=${hash}` : ''}`, url };
  }
  if (host === 'loom.com') {
    const m = /^\/(?:share|embed)\/([0-9a-f]{20,40})/.exec(u.pathname);
    if (!m) return null;
    return { provider: 'LOOM', videoId: m[1]!, embedUrl: `https://www.loom.com/embed/${m[1]}`, url };
  }
  if (host.endsWith('wistia.com') || host.endsWith('wistia.net') || host === 'wi.st') {
    const m = /\/(?:medias|embed\/iframe|embed\/medias)\/([a-z0-9]{6,20})/.exec(u.pathname);
    if (!m) return null;
    return { provider: 'WISTIA', videoId: m[1]!, embedUrl: `https://fast.wistia.net/embed/iframe/${m[1]}`, url };
  }
  if (host === 'dailymotion.com' || host === 'dai.ly') {
    const m = host === 'dai.ly' ? /^\/([a-z0-9]{5,12})/i.exec(u.pathname) : /^\/(?:embed\/)?video\/([a-z0-9]{5,12})/i.exec(u.pathname);
    if (!m) return null;
    return { provider: 'DAILYMOTION', videoId: m[1]!, embedUrl: `https://www.dailymotion.com/embed/video/${m[1]}`, url };
  }
  if (u.protocol === 'https:' && /\.(mp4|webm|ogv|mov|m4v)$/i.test(u.pathname)) return { provider: 'FILE_LINK', videoId: null, embedUrl: url, url };
  return null;
}

/** Hosts whose players the app may frame (kept in the page's Content Security Policy). */
export const VIDEO_FRAME_HOSTS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com', 'https://www.loom.com', 'https://fast.wistia.net', 'https://www.dailymotion.com'] as const;
/** Hosts of video preview images. */
export const VIDEO_IMAGE_HOSTS = ['https://i.ytimg.com', 'https://i.vimeocdn.com', 'https://cdn.loom.com', 'https://embed-ssl.wistia.com', 'https://s1.dmcdn.net', 'https://s2.dmcdn.net'] as const;
