# ADR 0102: Employee of the Month and Performance Improvement Plans

Status: accepted (2026-11-27)

## Context

Kunal asked for two things on the dashboards:

- **Employee of the Month.** It shows on every executive dashboard all month. Managers and the Super Workspace set monthly targets. People who reach them become eligible, and a winner is chosen. The winner gets a celebration, a certificate and a place in the history.
- **Performance Improvement Plans (PIPs).** Managers give plans to their executives, and the Super Workspace to managers and executives. A plan has goals, reviews, acknowledgement and comments. It shows on the person's dashboard only while it is open, and it closes only when an authorised person decides.

The standing rules apply:

- Everything is real and kept in the database.
- Nothing depends on AI.
- Progress is counted from records.
- Nothing is random.
- Company auto-fill is left alone.

## Decision

### Who may do what

The rules follow the workspace hierarchy (ADR 0071) and are checked on the server in every call (`apps/api/src/recognition/people.ts`):

| | Super Workspace | Manager | Executive |
|---|---|---|---|
| Set Employee of the Month targets | anyone below | its executives, if the policy allows | no |
| Name the winner | the organisation's winner, and any team's | its team's winner, if the policy allows | no |
| Run the automatic selection, withdraw an award, change the rules | yes | no | no |
| Assign, change and evaluate plans | managers and executives | its executives, if the policy allows | no |
| Decide plans (complete, extend, unsuccessful, cancel) | yes | if the policy allows | no |
| See | everyone | itself and its executives | only itself |

The Super Workspace's policy (`RecognitionPolicy`) has a switch for each "if the policy allows" in the table.

### Counting

Goals reuse the shared counter of ADR 0096 (`Measures`): companies, contacts, calls, emails, follow-ups, meetings, deals, revenue, RFQs and conversions. Four more measures are added:

- Task completion rate.
- Overall target achievement.
- Training modules completed and training assessment score, read from the Learning module when it is present. Otherwise the goal is shown as "not measured yet".

A count goal can be for the whole period or per working day.

The achievement is the average of the goal percentages. The performance score is the average of the parts that have data: goals, workspace targets and tasks.

### Eligible is not selected

When the eligibility rule is met (every goal, or the overall figure, at or above the minimum, plus an optional minimum score), the target becomes **Eligible**. The person is told, and a small celebration plays.

Being eligible does not make anyone the winner. The winner is chosen in one of two ways:

- A manager or the Super Workspace picks from the eligible people (Method B).
- The automatic run takes the best of the policy's ordered ranking criteria (Method A). The automatic run happens at the end of the month, or when the Super Workspace presses Run.

A tie either waits for a person to decide or goes to whoever became eligible first, as the policy says. It is never random.

One award stands per organisation and per team each month. This is enforced by a unique `liveKey`. A withdrawn award stays in the history with the reason.

### Plans

A plan's statuses are Draft, Active, In progress (after acknowledgement), Ready for review, Under review, Extended, Successfully completed, Unsuccessful and Cancelled.

- **Ready for review** comes automatically when every goal is met, and goes back to the earlier status if a goal stops being met.
- **Successfully completed** needs the goals met and a decision.
- A passed deadline never fails a plan.

Manager evaluation goals take a score from 0 to 100, with comments, and the latest score counts.

Review dates come from the frequency, or from dates the manager chooses. Reminders go out `reviewReminderDays` before each review.

Every action is written to an append-only `PerformancePlanEvent` history and to the audit log.

### Screens

- **Employee of the Month card.** Always on the dashboard, for executives and managers. The Super Workspace sees the winners. The card has:
  - an animated trophy, a band of light and the winner spotlight;
  - the person's ring and goals;
  - Eligible versus winner, explained;
  - the reward, the days left and earlier awards;
  - a certificate download.
- **Improvement plan card.** Only while a plan is open, then a one-time completion note. It has:
  - the plan number, status, dates and days remaining;
  - each goal with required, done, remaining and percentage;
  - current and required level, manager feedback, and a pulsing dot when a review is near;
  - Acknowledge and Comment buttons.
- **Recognition page** (`/app/recognition`). Three tabs:
  - Employee of the Month: targets, the ranking, choosing or withdrawing a winner, and the history.
  - Improvement plans: assign, evaluate, review, decide, and the history.
  - Rules: for the Super Workspace only.
- **Celebrations.** Three new kinds in the celebrations of ADR 0090: `EMPLOYEE_OF_THE_MONTH` (full-screen stage), `RECOGNITION_ELIGIBLE` and `PIP_COMPLETED`.
- **Certificate.** A landscape A4 PDF in the reader's language, with Arabic right to left (ADR 0054).
- **Notifications.** They use the `recognition.*` and `pip.*` types, which have their own categories in notification settings.

Motion is gentle. It stops for reduced motion, and the cards sit in the dashboard flow, so they never cover other elements.

## Consequences

- There is no new plan feature: access follows the hierarchy and the policy.
- Training goals depend on the Learning module's `learningAssignment` records. Until that module is merged they show as "not measured yet".
- Earlier behaviour changed: the role dashboards gain the two cards above the existing content, and the menu gains "Recognition" after "Performance".
