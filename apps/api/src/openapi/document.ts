import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
  acceptInvitationSchema,
  acceptNextStepSchema,
  actionDecisionSchema,
  aiSettingsUpdateSchema,
  copilotRequestSchema,
  createActionItemsSchema,
  forecastQuerySchema,
  meetingNotesRequestSchema,
  snapshotInputSchema,
  workflowDraftRequestSchema,
  activityInputSchema,
  approvalDecisionSchema,
  sendEmailSchema,
  simulateSchema,
  webhookInputSchema,
  workflowInputSchema,
  assignSchema,
  bulkDealUpdateSchema,
  companyInputSchema,
  companyUpdateSchema,
  contactInputSchema,
  contactUpdateSchema,
  cursorPageQuerySchema,
  customFieldDefSchema,
  dealInputSchema,
  dealMoveSchema,
  dealUpdateSchema,
  importRequestSchema,
  invitationInputSchema,
  leadConvertSchema,
  leadInputSchema,
  leadUpdateSchema,
  listQuerySchema,
  pipelineInputSchema,
  taskInputSchema,
  taskListQuerySchema,
  taskUpdateSchema,
  loginSchema,
  registerSchema,
  switchTenantSchema,
  updateMemberRoleSchema,
  updateTenantSchema,
  z,
} from '@dealflow/types';

extendZodWithOpenApi(z);

/**
 * OpenAPI 3.1 description of the v1 API, generated from the same Zod schemas the API uses
 * for validation so the contract cannot drift from the implementation's inputs.
 */
export function buildOpenApiDocument(): object {
  const r = new OpenAPIRegistry();
  r.registerComponent('securitySchemes', 'cookieAuth', { type: 'apiKey', in: 'cookie', name: 'df_access' });
  r.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });

  const error = z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string().optional(),
      details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    }),
  });
  const json = (schema: z.ZodTypeAny, description: string) => ({
    description,
    content: { 'application/json': { schema } },
  });
  const errors = {
    400: json(error, 'Validation failed'),
    401: json(error, 'Not signed in'),
    403: json(error, 'Permission denied'),
    429: json(error, 'Rate limited'),
  };
  const secured: Record<string, string[]>[] = [{ cookieAuth: [] }, { bearerAuth: [] }];
  const tenantRef = z.object({ tenantId: z.string().uuid() });

  r.registerPath({ method: 'post', path: '/auth/register', tags: ['Auth'], summary: 'Create an account and workspace',
    request: { body: { content: { 'application/json': { schema: registerSchema } } } },
    responses: { 201: json(tenantRef, 'Signed in; auth cookies set'), 409: json(error, 'Email in use'), ...errors } });
  r.registerPath({ method: 'post', path: '/auth/login', tags: ['Auth'], summary: 'Sign in',
    request: { body: { content: { 'application/json': { schema: loginSchema } } } },
    responses: { 200: json(tenantRef, 'Signed in; auth cookies set'), ...errors } });
  r.registerPath({ method: 'post', path: '/auth/refresh', tags: ['Auth'], summary: 'Rotate the refresh token',
    responses: { 200: json(tenantRef, 'New cookies set'), ...errors } });
  r.registerPath({ method: 'post', path: '/auth/logout', tags: ['Auth'], summary: 'Revoke the session', responses: { 204: { description: 'Signed out' } } });
  r.registerPath({ method: 'get', path: '/auth/me', tags: ['Auth'], summary: 'Current user, workspace and permissions', security: secured,
    responses: { 200: { description: 'Session details' }, ...errors } });
  r.registerPath({ method: 'post', path: '/auth/switch-tenant', tags: ['Auth'], summary: 'Switch active workspace', security: secured,
    request: { body: { content: { 'application/json': { schema: switchTenantSchema } } } },
    responses: { 200: json(tenantRef, 'Switched'), ...errors } });

  r.registerPath({ method: 'get', path: '/tenants/current', tags: ['Tenants'], summary: 'Active workspace (tenant:read)', security: secured,
    responses: { 200: { description: 'Workspace' }, ...errors } });
  r.registerPath({ method: 'patch', path: '/tenants/current', tags: ['Tenants'], summary: 'Update workspace settings (tenant:manage)', security: secured,
    request: { body: { content: { 'application/json': { schema: updateTenantSchema } } } },
    responses: { 200: { description: 'Updated workspace' }, ...errors } });
  r.registerPath({ method: 'get', path: '/tenants/current/members', tags: ['Tenants'], summary: 'List members (members:read)', security: secured,
    responses: { 200: { description: 'Members' }, ...errors } });
  r.registerPath({ method: 'get', path: '/tenants/current/roles', tags: ['Tenants'], summary: 'List roles (members:read)', security: secured,
    responses: { 200: { description: 'Roles' }, ...errors } });
  r.registerPath({ method: 'patch', path: '/tenants/current/members/{membershipId}/role', tags: ['Tenants'], summary: 'Change a member role (members:manage)', security: secured,
    request: { params: z.object({ membershipId: z.string().uuid() }), body: { content: { 'application/json': { schema: updateMemberRoleSchema } } } },
    responses: { 200: { description: 'Updated member' }, ...errors } });

  r.registerPath({ method: 'get', path: '/dashboard/summary', tags: ['Dashboard'], summary: 'Command Center KPIs from live data (dashboard:read)', security: secured,
    responses: { 200: { description: 'KPIs, pipeline and recent activity' }, ...errors } });
  r.registerPath({ method: 'get', path: '/audit-logs', tags: ['Audit'], summary: 'Audit log, newest first (audit:read)', security: secured,
    request: { query: cursorPageQuerySchema }, responses: { 200: { description: 'Cursor page of audit events' }, ...errors } });
  // ───── Core CRM ─────
  const body = (schema: z.ZodTypeAny) => ({ body: { content: { 'application/json': { schema } } } });
  const idParam = z.object({ id: z.string().uuid() });
  const ok = (description: string) => ({ description });
  const notFound = { 404: json(error, 'Not found in this workspace') };
  const crud = (path: string, tag: string, perm: string, create: z.ZodTypeAny, update: z.ZodTypeAny) => {
    r.registerPath({ method: 'get', path, tags: [tag], summary: `List (${perm}:read)`, security: secured, request: { query: listQuerySchema }, responses: { 200: ok('Page of records'), ...errors } });
    r.registerPath({ method: 'post', path, tags: [tag], summary: `Create (${perm}:write)`, security: secured, request: body(create), responses: { 201: ok('Created'), ...errors } });
    r.registerPath({ method: 'get', path: `${path}/{id}`, tags: [tag], summary: `Get (${perm}:read)`, security: secured, request: { params: idParam }, responses: { 200: ok('Record'), ...notFound, ...errors } });
    r.registerPath({ method: 'patch', path: `${path}/{id}`, tags: [tag], summary: `Update (${perm}:write)`, security: secured, request: { params: idParam, ...body(update) }, responses: { 200: ok('Updated'), ...notFound, ...errors } });
    r.registerPath({ method: 'delete', path: `${path}/{id}`, tags: [tag], summary: `Delete (soft) (${perm}:write)`, security: secured, request: { params: idParam }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });
  };
  crud('/leads', 'Leads', 'leads', leadInputSchema, leadUpdateSchema);
  crud('/contacts', 'Contacts', 'contacts', contactInputSchema, contactUpdateSchema);
  crud('/companies', 'Companies', 'companies', companyInputSchema, companyUpdateSchema);
  crud('/deals', 'Deals', 'deals', dealInputSchema, dealUpdateSchema);
  const action = (method: 'get' | 'post' | 'put' | 'delete', path: string, tag: string, summary: string, schema?: z.ZodTypeAny, extra: object = {}) =>
    r.registerPath({ method, path, tags: [tag], summary, security: secured,
      request: { ...(path.includes('{id}') ? { params: idParam } : {}), ...(schema ? body(schema) : {}), ...extra },
      responses: { 200: ok('OK'), ...notFound, ...errors } });
  action('post', '/leads/{id}/assign', 'Leads', 'Assign an owner (leads:write)', assignSchema);
  action('get', '/leads/{id}/duplicates', 'Leads', 'Possible duplicates by email, phone or name and company (leads:read)');
  action('post', '/leads/{id}/merge', 'Leads', 'Merge a duplicate into this lead (leads:write)', z.object({ duplicateId: z.string().uuid() }));
  action('post', '/leads/{id}/convert', 'Leads', 'Convert into contact, company and deal (leads, contacts, companies, deals:write)', leadConvertSchema);
  action('get', '/deals/board', 'Deals', 'Kanban board for a pipeline (deals:read)', undefined, { query: z.object({ pipelineId: z.string().uuid().optional(), perStage: z.number().int().optional() }) });
  action('post', '/deals/{id}/move', 'Deals', 'Move to another stage; Lost needs a reason (deals:write)', dealMoveSchema);
  action('post', '/deals/{id}/clone', 'Deals', 'Clone into the first stage (deals:write)');
  action('post', '/deals/bulk-update', 'Deals', 'Reassign or move up to 200 deals (deals:write)', bulkDealUpdateSchema);
  action('get', '/pipelines', 'Pipelines', 'Pipelines with stages (pipelines:read)');
  action('post', '/pipelines', 'Pipelines', 'Create; limited by plan (pipelines:manage)', pipelineInputSchema);
  action('put', '/pipelines/{id}', 'Pipelines', 'Replace name and stages (pipelines:manage)', pipelineInputSchema);
  action('post', '/pipelines/{id}/default', 'Pipelines', 'Make default (pipelines:manage)');
  action('delete', '/pipelines/{id}', 'Pipelines', 'Delete an empty, non-default pipeline (pipelines:manage)');
  action('get', '/activities', 'Activities', 'Timeline for a record (activities:read)', undefined, { query: z.object({ leadId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), companyId: z.string().uuid().optional(), opportunityId: z.string().uuid().optional() }) });
  action('post', '/activities', 'Activities', 'Log a call, email, meeting or note (activities:write)', activityInputSchema);
  action('delete', '/activities/{id}', 'Activities', 'Delete (activities:write)');
  action('get', '/tasks', 'Tasks', 'My or all tasks (activities:read)', undefined, { query: taskListQuerySchema });
  action('post', '/tasks', 'Tasks', 'Create a task (activities:write)', taskInputSchema);
  r.registerPath({ method: 'patch', path: '/tasks/{id}', tags: ['Tasks'], summary: 'Update or complete (activities:write)', security: secured, request: { params: idParam, ...body(taskUpdateSchema) }, responses: { 200: ok('Updated'), ...notFound, ...errors } });
  action('get', '/search', 'Search', 'Search records the caller can read', undefined, { query: z.object({ q: z.string(), limit: z.number().int().optional() }) });
  action('get', '/custom-fields', 'Custom fields', 'Definitions (tenant:read)');
  action('post', '/custom-fields', 'Custom fields', 'Define a field (tenant:manage)', customFieldDefSchema);
  action('delete', '/custom-fields/{id}', 'Custom fields', 'Archive a field (tenant:manage)');
  action('get', '/imports/fields', 'Import & export', 'Fields a CSV column can map to');
  action('post', '/imports', 'Import & export', 'Import CSV, with dry run and duplicate skipping (<entity>:write)', importRequestSchema);
  r.registerPath({ method: 'get', path: '/exports/{entity}', tags: ['Import & export'], summary: 'Export CSV; audited (data:export and <entity>:read)', security: secured,
    request: { params: z.object({ entity: z.enum(['leads', 'contacts', 'companies', 'deals']) }) },
    responses: { 200: { description: 'CSV file', content: { 'text/csv': { schema: z.string() } } }, ...errors } });
  action('get', '/tenants/current/invitations', 'Tenants', 'Invitations (members:read)');
  action('post', '/tenants/current/invitations', 'Tenants', 'Invite by email; returns the link once — email delivery is not configured (members:manage)', invitationInputSchema);
  action('delete', '/tenants/current/invitations/{id}', 'Tenants', 'Revoke (members:manage)');
  r.registerPath({ method: 'get', path: '/auth/invitations/{token}', tags: ['Auth'], summary: 'Preview an invitation', request: { params: z.object({ token: z.string() }) }, responses: { 200: ok('Workspace, email and role'), ...notFound } });
  r.registerPath({ method: 'post', path: '/auth/invitations/accept', tags: ['Auth'], summary: 'Accept; existing accounts confirm their password', request: body(acceptInvitationSchema), responses: { 200: json(tenantRef, 'Joined; auth cookies set'), ...notFound, ...errors } });

  action('get', '/workflows', 'Automation', 'Workflows with 30-day run stats (automation:manage)');
  action('post', '/workflows', 'Automation', 'Create a draft workflow (automation:manage)', workflowInputSchema);
  action('get', '/workflows/{id}', 'Automation', 'Workflow with its latest version (automation:manage)');
  action('put', '/workflows/{id}', 'Automation', 'Save a new immutable version (automation:manage)', workflowInputSchema);
  r.registerPath({ method: 'patch', path: '/workflows/{id}/status', tags: ['Automation'], summary: 'Activate or pause (automation:manage)', security: secured,
    request: { params: idParam, ...body(z.object({ status: z.enum(['ACTIVE', 'PAUSED']) })) }, responses: { 200: ok('Updated'), ...notFound, ...errors } });
  action('get', '/workflows/{id}/versions', 'Automation', 'Version history (automation:manage)');
  action('delete', '/workflows/{id}', 'Automation', 'Delete; cancels unfinished runs (automation:manage)');
  action('post', '/workflows/simulate', 'Automation', 'Dry run against a record; nothing is written (automation:manage)', simulateSchema);
  action('get', '/workflows/executions', 'Automation', 'Run history with steps (automation:manage)', undefined, { query: z.object({ workflowId: z.string().uuid().optional(), status: z.string().optional(), limit: z.number().int().optional() }) });
  action('get', '/approvals', 'Automation', 'Approval requests (automation:manage)', undefined, { query: z.object({ status: z.enum(['PENDING', 'DECIDED']).optional() }) });
  action('post', '/approvals/{id}/decision', 'Automation', 'Approve or reject (automation:manage)', approvalDecisionSchema);
  action('get', '/notifications', 'Notifications', "The caller's notifications and unread count");
  action('post', '/notifications/read', 'Notifications', 'Mark some or all as read', z.object({ ids: z.union([z.literal('all'), z.array(z.string().uuid())]) }));
  action('get', '/webhooks', 'Webhooks', 'Endpoints with recent deliveries (integrations:manage)');
  action('post', '/webhooks', 'Webhooks', 'Create; returns the signing secret once (integrations:manage)', webhookInputSchema);
  r.registerPath({ method: 'patch', path: '/webhooks/{id}', tags: ['Webhooks'], summary: 'Change URL or events, or switch on and off (integrations:manage)', security: secured,
    request: { params: idParam, ...body(webhookInputSchema.partial().extend({ active: z.boolean().optional() })) }, responses: { 200: ok('Updated'), ...notFound, ...errors } });
  action('delete', '/webhooks/{id}', 'Webhooks', 'Delete (integrations:manage)');
  r.registerPath({ method: 'post', path: '/webhooks/{id}/deliveries/{deliveryId}/redeliver', tags: ['Webhooks'], summary: 'Queue a failed delivery again (integrations:manage)', security: secured,
    request: { params: z.object({ id: z.string().uuid(), deliveryId: z.string().uuid() }) }, responses: { 202: ok('Queued'), ...notFound, ...errors } });
  action('get', '/integrations', 'Integrations', "Provider set-up and the caller's connections (activities:read)");
  r.registerPath({ method: 'post', path: '/integrations/{provider}/connect', tags: ['Integrations'], summary: 'Start OAuth; 409 when the provider is not configured (activities:write)', security: secured,
    request: { params: z.object({ provider: z.enum(['google', 'microsoft']) }) }, responses: { 200: ok('Authorization URL'), ...errors } });
  r.registerPath({ method: 'post', path: '/integrations/{provider}/sync', tags: ['Integrations'], summary: 'Sync now (activities:write)', security: secured,
    request: { params: z.object({ provider: z.enum(['google', 'microsoft']) }) }, responses: { 200: ok('Counts of new emails and meetings'), ...errors } });
  r.registerPath({ method: 'delete', path: '/integrations/{provider}', tags: ['Integrations'], summary: 'Disconnect and delete stored tokens (activities:write)', security: secured,
    request: { params: z.object({ provider: z.enum(['google', 'microsoft']) }) }, responses: { 204: ok('Disconnected'), ...errors } });
  action('get', '/emails', 'Communication', 'Synced and sent email linked to records (activities:read)', undefined, { query: z.object({ contactId: z.string().uuid().optional(), leadId: z.string().uuid().optional() }) });
  action('get', '/emails/{id}', 'Communication', 'One email with its body (activities:read)');
  action('post', '/emails/send', 'Communication', "Send one email from the caller's mailbox; daily cap applies (activities:write)", sendEmailSchema);
  action('get', '/meetings', 'Communication', 'Synced meetings with known contacts (activities:read)', undefined, { query: z.object({ from: z.string().optional(), to: z.string().optional(), contactId: z.string().uuid().optional() }) });

  // AI: every route also needs ai:use; model calls are metered in credits and can return 402/409/429/503.
  action('get', '/ai/status', 'AI', 'Provider, settings, credits and per-agent availability (ai:use)');
  r.registerPath({ method: 'patch', path: '/ai/settings', tags: ['AI'], summary: 'Kill switch, agent switches, auto-qualify, redaction, credit cap; audited (ai:manage)', security: secured,
    request: body(aiSettingsUpdateSchema), responses: { 200: ok('Updated status'), ...errors } });
  action('get', '/ai/usage', 'AI', 'Usage by agent this month and recent runs (ai:manage)');
  action('get', '/ai/runs/{id}', 'AI', 'One agent run (ai:manage)');
  action('post', '/ai/copilot', 'AI', 'Ask Copilot; changes come back as proposals (ai:use)', copilotRequestSchema);
  action('get', '/ai/copilot/conversations/{id}', 'AI', "The caller's turns in a conversation (ai:use)");
  r.registerPath({ method: 'post', path: '/ai/copilot/runs/{runId}/actions/{actionId}', tags: ['AI'], summary: 'Confirm or dismiss a proposed change; permission re-checked (ai:use, asker only)', security: secured,
    request: { params: z.object({ runId: z.string().uuid(), actionId: z.string().uuid() }), ...body(actionDecisionSchema) }, responses: { 200: ok('The action with its outcome'), ...notFound, ...errors } });
  action('post', '/ai/leads/{id}/qualify', 'AI', 'Score a lead from explainable signals, with an AI summary when available (ai:use, leads:write)');
  action('post', '/ai/deals/{id}/analyse', 'AI', 'Deal health and a recommended next step (ai:use, deals:read)');
  action('post', '/ai/deals/{id}/proposal', 'AI', 'Draft a proposal outline from the deal; nothing is sent (ai:use, deals:read)');
  action('post', '/ai/meeting-notes', 'AI', 'Summarise pasted notes into decisions, action items and a follow-up draft (ai:use, activities:write)', meetingNotesRequestSchema);
  action('post', '/ai/workflows/draft', 'AI', 'Turn a description into a validated workflow definition; not saved (ai:use, automation:manage)', workflowDraftRequestSchema);
  action('get', '/ai/recommendations', 'AI', 'Agent results for a record (ai:use)', undefined, { query: z.object({ entityType: z.enum(['lead', 'contact', 'deal']), entityId: z.string().uuid() }) });
  action('post', '/ai/recommendations/{id}/accept', 'AI', 'Accept: creates the task or note as the caller (ai:use)', acceptNextStepSchema);
  action('post', '/ai/recommendations/{id}/dismiss', 'AI', 'Dismiss (ai:use)');
  action('post', '/ai/recommendations/{id}/tasks', 'AI', 'Create tasks from chosen meeting action items (ai:use, activities:write)', createActionItemsSchema);
  action('post', '/ai/forecast/explain', 'AI', 'Snapshot comparison with a written explanation (ai:use, dashboard:read, deals:read)', z.object({ from: z.string().uuid(), to: z.string().uuid() }));
  action('get', '/forecast', 'Forecasting', 'Weighted forecast for a quarter; rule-based, no AI (dashboard:read, deals:read)', undefined, { query: forecastQuerySchema });
  action('get', '/forecast/snapshots', 'Forecasting', 'Snapshots for a quarter (dashboard:read, deals:read)', undefined, { query: forecastQuerySchema });
  r.registerPath({ method: 'post', path: '/forecast/snapshots', tags: ['Forecasting'], summary: 'Store an immutable snapshot with its lines (dashboard:read, deals:read)', security: secured,
    request: body(snapshotInputSchema), responses: { 201: ok('Snapshot'), ...errors } });
  r.registerPath({ method: 'get', path: '/forecast/snapshots/{id}/verify', tags: ['Forecasting'], summary: 'Recompute totals from the stored lines (dashboard:read, deals:read)', security: secured,
    request: { params: idParam }, responses: { 200: ok('Stored and recomputed totals'), ...notFound, ...errors } });
  action('get', '/forecast/compare', 'Forecasting', 'Deal-level changes between two snapshots (dashboard:read, deals:read)', undefined, { query: z.object({ from: z.string().uuid(), to: z.string().uuid() }) });

  r.registerPath({ method: 'get', path: '/health/live', tags: ['Health'], summary: 'Liveness', responses: { 200: { description: 'OK' } } });
  r.registerPath({ method: 'get', path: '/health/ready', tags: ['Health'], summary: 'Readiness', responses: { 200: { description: 'OK' }, 503: json(error, 'Not ready') } });

  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'DealFlow API', version: '1.0.0', description: 'DealFlow by Sampledge, REST API v1.' },
    servers: [{ url: '/api/v1' }],
  });
}
