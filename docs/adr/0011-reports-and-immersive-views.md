# ADR 0011: Report builder, stage history and the immersive views

**Status:** accepted (2026-10-30)

**Context.** Phase 7 adds a report builder with dashboards, and four visual explorers: the Relationship Galaxy,
the Revenue Globe, pipeline flow and pipeline replay. The builder lets people describe a query, which is the
classic route to SQL injection and to reading another role's data. The explorers need history (when a deal entered
each stage) that SampForce had only kept as audit-log text, and 3D graphics that must not make the product slower,
less accessible or unusable on weak devices.

**Decision.**

- **Reports are data, not SQL.** A report definition (`reportDefinitionSchema` in `@dealflow/types`) names an
  entity, one metric, an optional grouping (with a date bucket), up to 10 filters, a chart type, an order and a row
  limit (max 100). Field keys must exist in the shared catalogue, operators must suit the field's kind, and values
  are type-checked. The API maps each key to a fixed SQL expression in `report-sql.ts`; every value is a bound
  parameter, `LIKE` wildcards are escaped, and stored definitions are re-validated before they run. Each query runs
  inside the tenant's RLS transaction, also filters `tenant_id` explicitly, and has a 10 s statement timeout.
- **Who sees what.** `reports:read` (every system role) lists and runs reports; `reports:write` (members and up)
  saves private or shared reports and dashboards; `reports:manage` (managers and up) edits other people's shared
  ones. Running any report also needs the entity's own read permission, so a shared deals report is refused for a
  role without `deals:read`. CSV export needs `data:export` and is audited (`report.exported`). A shared dashboard
  can only hold shared reports; deleting a report removes it from every dashboard.
- **Money is converted, never guessed.** Money metrics are summed in the workspace currency using the latest
  manual exchange rate (the same rule as Revenue Intelligence). Records in a currency without a rate are left out
  and counted in the result (`excluded`), and the UI says so.
- **Stage history is a table.** `deal_stage_events` records every stage a deal enters (on create, move, clone and
  lead conversion), append-only for the application role. The migration back-fills it from the audit log: one
  event at each deal's creation, then one per logged move whose stage names still match a single stage of the
  pipeline; these rows are marked `reconstructed` and the replay says so.
- **3D is an enhancement, never the only view.** Three.js through React Three Fiber, loaded only when a 3D view
  opens (`next/dynamic`, no SSR). Every 3D view has a 2D view with the same data, and a table or list that is the
  accessible equivalent. 2D is used automatically in low-power mode, without WebGL, or after a lost GPU context,
  and offered when the device stays under 24 fps at the lowest quality. Pipeline flow and replay are 2D (SVG) by
  design: their meaning is order and time, which a flat view shows more clearly.
- **Performance budget.** One draw call for all galaxy nodes (instanced mesh), one for all edges, one for globe
  bars; Lambert materials; at most 150 companies, 600 contacts and 800 deals in the galaxy and 400 deals in a replay.
  Rendering is on demand (no GPU work while idle) except during auto-rotation; the pixel ratio is capped at 2 and
  steps down to 1 when frames run slow. The force layout runs once in a Web Worker. The 3D code is about 250 KB
  gzipped and is fetched only by the Galaxy and Globe pages.
- **Motion.** Reduced motion (the OS setting or SampForce's own) stops auto-rotation, damping and animated flow
  lines; replay still plays on request but moves dots without tweening. Motion "off" disables all animation.

**Consequences.**

- The 60 FPS target could only be checked in this environment's software renderer (SwiftShader on 4 CPU cores,
  no GPU), where the galaxy ran at about 7 to 10 fps and the globe at 10 to 17 fps with a test workspace of 47 companies, 100 contacts and 95 deals. That
  says nothing reliable about real hardware; it does show the slow-device path works. The frame-rate readout on
  both views exists so this can be measured on real devices before launch.
- Replays use each deal's current amount, not the amount it had on the day.
- Spatial dashboards (dashboards placed in 3D space) were not built: the 2D dashboard grid already answers the
  same questions and a 3D arrangement would add motion without adding information.
