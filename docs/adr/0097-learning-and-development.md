# 0097: Learning & Development

Date: 2026-11-27. Status: accepted.

## Decision

- **A Learning section in every workspace** (feature `learning`, feature catalogue version 6), in the Workspace
  group of the menu. Learners get a home page with their assigned and open modules, a lesson player, assessments,
  results with retries, certificates and an Achievement dashboard. Managers get Learning management (modules,
  people, workspaces and categories, reports), a module builder, a marking queue and settings.
- **Modules** have a title, summary, description, category, level, audience levels, estimated minutes, pass mark,
  attempts allowed, time limit, question shuffling, when answers are shown, a certificate switch, a cover colour and
  a version history. Lessons are video links, uploaded video, audio, PDFs, Word, PowerPoint, Excel or CSV files,
  images or written text. Uploads are stored in the database like other files and streamed in byte ranges so video
  and audio can seek. Progress, watch position, notes and bookmarks are kept per person.
- **Questions are drafted without AI.** `apps/api/src/learning/generator.ts` uses only sentences that are in the
  material: it finds the key terms, scores the sentences that state facts about them, and turns them into fill in
  the blanks, multiple choice, true or false, matching and multiple select questions. Wrong choices come from other
  terms of the same kind in the same material. Each draft keeps its source sentence, and nothing is used until a
  manager approves it. Managers can also write questions of all ten types by hand (adding short answer, written
  answer, scenario, practical task and file upload) and keep them in a question bank.
- **Reading the material.** Text is read from PDFs (pdf.js), Office files (zip/XML), CSV, HTML, RTF and OpenDocument.
  Scanned PDFs and images go through Tesseract inside the server (English data ships with SampForce, nothing leaves
  the server; `LEARNING_OCR=false` turns it off). For a pasted video link SampForce checks the provider (YouTube,
  Vimeo, Loom, Wistia, Dailymotion or a direct file), reads the title, preview and length where shared, and looks for
  captions. When nothing can be read it says so plainly and the manager can paste a transcript. It never claims to
  have "watched" a video.
- **Marking happens on the server.** An attempt copies its questions and answer key when it starts, so later edits
  never change an attempt already taken. Objective answers are marked on submit; written, practical and upload
  answers wait in the marking queue for a manager. Answers autosave, the timer submits at zero, and when attempts run
  out a manager can give one more.
- **Certificates** are issued once per passed assignment, only after a real pass. Each has a number and a public
  verification code. The PDF has a QR code that opens `/verify/certificate/{code}`, which shows whether it is valid
  or revoked. Templates, signature name and title are set in Learning settings. Managers can revoke and restore.
- **Assignments** go to levels, workspaces or named people, with a deadline, mandatory flag and note. Reminders go at
  the module's "days before" marks (3 and 1 by default), on the day, when overdue and then every few days for up to
  60 days, each one once only (`remindersSent` keys, and a notification event id). The
  manager is told when an assignment becomes overdue and when work is waiting to be marked.
- **Permissions are enforced on the server** in `access.ts`: the Super Workspace's managers see and manage the whole
  organisation, a Manager Workspace only its own branch, and executives only their own learning.
- **Reports** show completion, scores and certificates by person, module, workspace and category, with an Excel
  export.
- **Security headers.** Learning files and certificates may be shown in a frame on SampForce's own pages
  (`frame-ancestors 'self'`), and other files are sandboxed. The page CSP allows the video providers' players
  (`frame-src`) and preview images, kept equal to the provider lists in `@dealflow/types` by a test.
- **AI is not used.** `aiAvailable` is false. A local Ollama model could later be offered as an optional last step
  for wording drafts. It would be off by default, and nothing in this section depends on it.

## Tests

`apps/api/test/learning.e2e.test.ts` covers the full pass and fail/retry flow: a module from a video's captions,
assigning within a branch, failing with feedback, retrying and passing, one certificate with its PDF and public
check, manual marking, an extra attempt, reminders sent once each, and uploads that cannot be read. Generator and
scoring unit tests sit next to their code. `apps/web/e2e/learning.spec.ts` runs the same flow in the browser as the
Super Workspace, a manager and an executive (build, draft and approve questions, publish, assign, read, fail, retry,
pass, celebration, certificate, public check, reports and Excel export). With `PREVIEW_DIR` set it saves screenshots.

## Not covered

- Captions are read only where the provider publishes them. Video files themselves are not transcribed.
- OCR is English only.
- The learning progress summary `learningProgressFor` in `summary.ts` is ready to use for performance reviews, but
  nothing reads it yet.
