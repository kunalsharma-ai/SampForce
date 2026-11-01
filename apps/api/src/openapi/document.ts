import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
  VOICE_RECORD_TYPES,
  customerFollowUpsSchema,
  badgeInputSchema,
  competitionInputSchema,
  gamificationSettingsSchema,
  visitorSettingsSchema,
  prospectListInputSchema,
  prospectAddSchema,
  prospectImportCommitSchema,
  prospectMoveSchema,
  prospectIdsSchema,
  prospectToCrmSchema,
  prospectUpdateSchema,
  prospectSettingsSchema,
  providerSearchSchema,
  providerAddSchema,
  collectSchema,
  enquirySchema,
  teamInputSchema,
  voiceApplySchema,
  voiceInterpretSchema,
  voiceNoteCreateSchema,
  voiceNoteUpdateSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaPolicySchema,
  mfaRegenerateSchema,
  mfaSetupSchema,
  mfaVerifySchema,
  scimTokenCreateSchema,
  ssoConnectionSchema,
  acceptInvitationSchema,
  acceptNextStepSchema,
  actionDecisionSchema,
  aiSettingsUpdateSchema,
  copilotRequestSchema,
  createActionItemsSchema,
  forecastQuerySchema,
  forecastSettingsSchema,
  campaignInputSchema,
  changePlanSchema,
  checkoutSchema,
  dashboardInputSchema,
  immersiveQuerySchema,
  dealHealthQuerySchema,
  insightQuerySchema,
  nextActionAcceptSchema,
  nextActionDismissSchema,
  nextActionQuerySchema,
  timelineQuerySchema,
  reportDefinitionSchema,
  reportInputSchema,
  invoiceRequestSchema,
  operatorLoginSchema,
  operatorPaymentSchema,
  operatorPlanSchema,
  operatorStatusSchema,
  operatorVoidSchema,
  paymentInstructionsSchema,
  roleInputSchema,
  seatsSchema,
  supportGrantSchema,
  trialSchema,
  commercialSettingsSchema,
  contractInputSchema,
  contractSignSchema,
  contractTerminateSchema,
  contractUpdateSchema,
  escalationInputSchema,
  escalationResolveSchema,
  exchangeRateInputSchema,
  leadFormInputSchema,
  priceBookInputSchema,
  productInputSchema,
  proposalSendSchema,
  quoteInputSchema,
  quoteTransitionSchema,
  quoteUpdateSchema,
  salesTargetInputSchema,
  segmentInputSchema,
  emailTemplateInputSchema,
  enrollInputSchema,
  sequenceTestSendSchema,
  sequenceInputSchema,
  sequenceStatusSchema,
  extensionCaptureSchema,
  extensionDiscoverSchema,
  extensionLoginMfaSchema,
  extensionLoginSchema,
  extensionProspectImportSchema,
  extensionLookupSchema,
  extensionTokenCreateSchema,
  finderSaveSchema,
  finderSearchSchema,
  suppressionInputSchema,
  templatePreviewSchema,
  segmentRulesSchema,
  taxRateInputSchema,
  meetingNotesRequestSchema,
  snapshotInputSchema,
  workflowDraftRequestSchema,
  activityInputSchema,
  approvalDecisionSchema,
  inboxNoteSchema,
  meetingRecordCreateSchema,
  meetingRecordUpdateSchema,
  meetingTasksSchema,
  inboxQuerySchema,
  inboxUpdateSchema,
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
  passwordResetRequestSchema,
  passwordResetSchema,
  registerSchema,
  switchTenantSchema,
  updateMemberRoleSchema,
  updateTenantSchema,
  z,
  emailVariableInputSchema,
  emailDraftRequestSchema,
  emailRewriteRequestSchema,
  emailSubjectsRequestSchema,
  emailAnalyseRequestSchema,
  portalAcceptSchema,
  portalDecisionSchema,
  portalForgotSchema,
  portalInviteSchema,
  portalLoginSchema,
  portalMessageSchema,
  portalRequestCreateSchema,
  portalRequestUpdateSchema,
  portalResetSchema,
  portalSettingsSchema,
  portalUserUpdateSchema,
  PROVIDER_CHECK_KEYS,
  slackSettingsSchema,
  slackTestSchema,
  teamsAddChannelSchema,
  teamsChannelId,
  teamsSettingsSchema,
  teamsTestSchema,
  zoomMeetingCreateSchema,
  zoomMeetingListQuery,
  docusignListQuery,
  docusignSendSchema,
  docusignVoidSchema,
  paymentsConnectSchema,
  whatsappConnectSchema,
  whatsappConsentSchema,
  whatsappSendSchema,
  apiKeyCreateSchema,
  zapierSubscribeSchema,
  smsConsentSchema,
  smsSendSchema,
  twilioConnectSchema,
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
  r.registerPath({ method: 'post', path: '/auth/password-reset/request', tags: ['Auth'], summary: 'Email a one-time password reset link (same answer for unknown addresses)',
    request: { body: { content: { 'application/json': { schema: passwordResetRequestSchema } } } },
    responses: { 202: { description: 'Accepted; a link is sent if the address has a password account' }, 503: json(error, 'Account email is not set up (MAIL_NOT_CONFIGURED)'), ...errors } });
  r.registerPath({ method: 'post', path: '/auth/password-reset', tags: ['Auth'], summary: 'Set a new password with the emailed token; signs out every device',
    request: { body: { content: { 'application/json': { schema: passwordResetSchema } } } },
    responses: { ...errors, 204: { description: 'Password changed' }, 400: json(error, 'Invalid, used or expired link (RESET_LINK_INVALID)') } });
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
  const action = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, tag: string, summary: string, schema?: z.ZodTypeAny, extra: object = {}) =>
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
  r.registerComponent('securitySchemes', 'apiKey', { type: 'http', scheme: 'bearer', description: 'A dfk_ workspace API key. It acts as the person who created it, limited to its scopes; only CRM record, pipeline, activity and task routes accept it.' });
  action('get', '/api-keys', 'API keys', 'Workspace API keys, never the key itself (integrations:manage)');
  action('post', '/api-keys', 'API keys', 'Create a key; the full key is returned once; scopes must be within your own role (integrations:manage)', apiKeyCreateSchema);
  action('delete', '/api-keys/{id}', 'API keys', 'Revoke a key and remove its Zapier subscriptions (integrations:manage)');
  action('get', '/api-keys/zapier', 'API keys', 'Whether the Zapier app is published for this deployment, and live Zapier subscriptions (integrations:manage)');
  const keyed = [{ apiKey: [] }];
  r.registerPath({ method: 'get', path: '/zapier/me', tags: ['Zapier'], summary: 'Test a key: workspace, user and scopes', security: keyed, responses: { 200: ok('Who the key acts as'), 401: { description: 'Invalid, revoked or expired key' } } });
  r.registerPath({ method: 'post', path: '/zapier/hooks', tags: ['Zapier'], summary: 'REST-hook subscribe: deliver an event to a public https URL; the key needs the event\'s read scope', security: keyed, request: body(zapierSubscribeSchema), responses: { 201: ok('Subscription id'), ...errors } });
  r.registerPath({ method: 'delete', path: '/zapier/hooks/{id}', tags: ['Zapier'], summary: 'REST-hook unsubscribe (only subscriptions made with this key)', security: keyed, request: { params: idParam }, responses: { 204: ok('Removed'), ...notFound } });
  r.registerPath({ method: 'get', path: '/zapier/events/{id}', tags: ['Zapier'], summary: 'One event by id, shaped as its trigger payload with the current record (perform for a REST-hook delivery)', security: keyed, request: { params: idParam }, responses: { 200: ok('Record'), ...notFound } });
  r.registerPath({ method: 'get', path: '/zapier/samples/{event}', tags: ['Zapier'], summary: 'Up to 3 recent real records for an event, shaped as its payload; empty when there are none (no invented data)', security: keyed, request: { params: z.object({ event: z.string() }) }, responses: { 200: ok('Payload samples'), ...errors } });
  action('get', '/integrations', 'Integrations', "Provider set-up and the caller's connections (activities:read)");
  r.registerPath({ method: 'post', path: '/integrations/{provider}/connect', tags: ['Integrations'], summary: 'Start OAuth; 409 when the provider is not configured (activities:write)', security: secured,
    request: { params: z.object({ provider: z.enum(['google', 'microsoft']) }) }, responses: { 200: ok('Authorization URL'), ...errors } });
  r.registerPath({ method: 'post', path: '/integrations/{provider}/sync', tags: ['Integrations'], summary: 'Sync now (activities:write)', security: secured,
    request: { params: z.object({ provider: z.enum(['google', 'microsoft']) }) }, responses: { 200: ok('Counts of new emails and meetings'), ...errors } });
  r.registerPath({ method: 'delete', path: '/integrations/{provider}', tags: ['Integrations'], summary: 'Disconnect and delete stored tokens (activities:write)', security: secured,
    request: { params: z.object({ provider: z.enum(['google', 'microsoft']) }) }, responses: { 204: ok('Disconnected'), ...errors } });
  const appParam = { params: z.object({ app: z.enum(['slack', 'teams', 'zoom', 'docusign', 'payments', 'whatsapp']) }) };
  action('get', '/apps', 'Workspace apps', 'Workspace-wide apps (Slack) with Pending Configuration, Not connected, Connected or Needs reconnecting; never returns tokens (any member)');
  r.registerPath({ method: 'post', path: '/apps/{app}/connect', tags: ['Workspace apps'], summary: 'Start the OAuth install; 409 PROVIDER_NOT_CONFIGURED while the app is Pending Configuration (integrations:manage)', security: secured,
    request: appParam, responses: { 200: ok('Authorization URL'), ...errors } });
  r.registerPath({ method: 'get', path: '/apps/{app}/callback', tags: ['Workspace apps'], summary: 'OAuth redirect target; stores the bot token encrypted and redirects to the Integrations page',
    request: { ...appParam, query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }) }, responses: { 302: { description: 'Back to /app/integrations' } } });
  r.registerPath({ method: 'delete', path: '/apps/{app}', tags: ['Workspace apps'], summary: 'Disconnect: revokes the token at the provider and deletes it (integrations:manage)', security: secured,
    request: appParam, responses: { 204: ok('Disconnected'), ...errors } });
  r.registerPath({ method: 'get', path: '/apps/{app}/events', tags: ['Workspace apps'], summary: 'Last 50 sends and failures (integrations:manage)', security: secured,
    request: appParam, responses: { 200: ok('Events'), ...errors } });
  action('get', '/apps/slack/channels', 'Workspace apps', 'Public and private Slack channels the bot can see (automation:manage)');
  action('put', '/apps/slack/settings', 'Workspace apps', 'Set the default channel for workflow posts (integrations:manage)', slackSettingsSchema);
  action('post', '/apps/slack/test', 'Workspace apps', 'Post a test message to a channel or the default channel; 5 a minute (integrations:manage)', slackTestSchema);
  action('get', '/apps/teams/channels', 'Workspace apps', 'Teams channels added in Integrations, without their URLs (automation:manage)');
  action('post', '/apps/teams/channels', 'Workspace apps', 'Add a Teams channel by its Workflows URL; saved only if Teams accepts a welcome card; 10 a minute (integrations:manage)', teamsAddChannelSchema);
  r.registerPath({ method: 'delete', path: '/apps/teams/channels/{id}', tags: ['Workspace apps'], summary: 'Remove a Teams channel; removing the last one disconnects Teams (integrations:manage)', security: secured,
    request: { params: z.object({ id: teamsChannelId }) }, responses: { 200: ok('App status'), ...notFound, ...errors } });
  action('put', '/apps/teams/settings', 'Workspace apps', 'Set the default Teams channel (integrations:manage)', teamsSettingsSchema);
  action('post', '/apps/teams/test', 'Workspace apps', 'Post a test card to a Teams channel; 5 a minute (integrations:manage)', teamsTestSchema);
  action('post', '/apps/zoom/meetings', 'Workspace apps', "Schedule a Zoom meeting in the caller's Zoom user (by DealFlow email), linked to one lead, contact or deal and logged as an activity; recording needs the organiser's consent confirmation (activities:write)", zoomMeetingCreateSchema);
  action('get', '/apps/zoom/meetings', 'Workspace apps', 'Zoom meetings scheduled from DealFlow, with transcript status (activities:read)', undefined, { query: zoomMeetingListQuery });
  r.registerPath({ method: 'post', path: '/apps/zoom/events', tags: ['Workspace apps'], summary: "Zoom event notifications (endpoint.url_validation, recording.transcript_completed, app_deauthorized); authenticated by Zoom's x-zm-signature only. Transcripts are imported only for recorded meetings scheduled from DealFlow",
    responses: { 200: ok('Handled, or the URL validation answer'), 401: { description: 'Signature check failed' }, 403: { description: 'ZOOM_WEBHOOK_SECRET_TOKEN not set' } } });
  action('post', '/apps/docusign/envelopes', 'Workspace apps', 'Email a draft contract to one signer for e-signature through DocuSign; needs confirm: true; one open envelope per contract (contracts:write)', docusignSendSchema);
  action('get', '/apps/docusign/envelopes', 'Workspace apps', 'Envelopes sent from DealFlow and their status (contracts:read)', undefined, { query: docusignListQuery });
  action('post', '/apps/docusign/envelopes/{id}/void', 'Workspace apps', 'Void an envelope still out for signature (contracts:write)', docusignVoidSchema);
  action('post', '/apps/docusign/envelopes/{id}/check', 'Workspace apps', 'Read the envelope status from DocuSign; a completed envelope signs the draft contract (contracts:read)');
  r.registerPath({ method: 'get', path: '/apps/docusign/envelopes/{id}/document', tags: ['Workspace apps'], summary: 'Download the signed PDF with its certificate of completion, fetched from DocuSign (contracts:read)', security: secured,
    request: { params: idParam }, responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, ...notFound, ...errors } });
  r.registerPath({ method: 'post', path: '/apps/docusign/events', tags: ['Workspace apps'], summary: 'DocuSign Connect (JSON) envelope events; authenticated by X-DocuSign-Signature-N HMAC only; unknown envelopes are ignored',
    responses: { 200: ok('Acknowledged'), 401: { description: 'Signature check failed' }, 403: { description: 'DOCUSIGN_CONNECT_HMAC_KEY not set' } } });
  action('post', '/apps/payments/keys', 'Workspace apps', "Save the workspace's own Stripe (restricted or secret key) or Razorpay keys plus webhook secret after a read that charges nothing proves them; sealed, never returned; 5 a minute (integrations:manage)", paymentsConnectSchema);
  r.registerPath({ method: 'get', path: '/apps/payments/quotes/{quoteId}', tags: ['Workspace apps'], summary: 'Card payments started from one quote’s online proposal; paid only when the provider’s signed webhook confirmed the amount (quotes:read)', security: secured,
    request: { params: z.object({ quoteId: z.string().uuid() }) }, responses: { 200: ok('Payments'), ...errors } });
  r.registerPath({ method: 'post', path: '/apps/payments/webhooks/{hookId}', tags: ['Workspace apps'], summary: "One workspace's Stripe or Razorpay webhook; checked with that workspace's signing secret (Stripe-Signature with a 5-minute window, or X-Razorpay-Signature); retries are idempotent",
    request: { params: z.object({ hookId: z.string().regex(/^[a-f0-9]{24}$/) }) }, responses: { 200: ok('Acknowledged'), 404: { description: 'Unknown endpoint or signature check failed' } } });
  action('post', '/apps/whatsapp/keys', 'Workspace apps', "Save the workspace's own WhatsApp Cloud API number id, business account id, System User token and App Secret after a read that sends nothing proves them; sealed, never returned; 5 a minute (integrations:manage)", whatsappConnectSchema);
  action('get', '/apps/whatsapp/templates', 'Workspace apps', 'Approved templates on the number whose only variables are in the body (activities:read)');
  r.registerPath({ method: 'get', path: '/apps/whatsapp/contacts/{contactId}', tags: ['Workspace apps'], summary: "A contact's WhatsApp number, consent, 24-hour reply window and messages (contacts:read)", security: secured,
    request: { params: z.object({ contactId: z.string().uuid() }) }, responses: { 200: ok('WhatsApp thread'), ...notFound, ...errors } });
  action('post', '/apps/whatsapp/consents', 'Workspace apps', 'Record that a contact agreed to WhatsApp messages and how; needs confirm: true; required before any template (contacts:write)', whatsappConsentSchema);
  r.registerPath({ method: 'delete', path: '/apps/whatsapp/consents/{contactId}', tags: ['Workspace apps'], summary: "Withdraw a contact's WhatsApp consent (contacts:write)", security: secured,
    request: { params: z.object({ contactId: z.string().uuid() }) }, responses: { 200: ok('WhatsApp thread'), ...errors } });
  action('post', '/apps/whatsapp/messages', 'Workspace apps', 'Send one WhatsApp message to one contact: an approved template (needs consent) or free text within 24 hours of their last message; needs confirm: true; 30 a minute (activities:write)', whatsappSendSchema);
  r.registerPath({ method: 'get', path: '/apps/whatsapp/webhooks/{hookId}', tags: ['Workspace apps'], summary: "Meta's webhook verification: echoes hub.challenge only for this workspace's verify token",
    request: { params: z.object({ hookId: z.string() }), query: z.object({ 'hub.mode': z.string().optional(), 'hub.verify_token': z.string().optional(), 'hub.challenge': z.string().optional() }) }, responses: { 200: { description: 'The challenge, as text' }, 403: { description: 'Verification failed' } } });
  r.registerPath({ method: 'post', path: '/apps/whatsapp/webhooks/{hookId}', tags: ['Workspace apps'], summary: "Meta's signed deliveries (X-Hub-Signature-256 with the workspace's App Secret): inbound messages, STOP opt-outs and delivery status; retries are idempotent",
    request: { params: z.object({ hookId: z.string() }) }, responses: { 200: ok('Acknowledged'), 401: { description: 'Signature check failed' }, 404: { description: 'Unknown endpoint' } } });
  action('post', '/apps/twilio/keys', 'Workspace apps', 'Save the workspace’s Twilio Account SID, Auth Token and SMS number after reads prove them; sends nothing (integrations:manage)', twilioConnectSchema);
  r.registerPath({ method: 'get', path: '/apps/twilio/contacts/{contactId}', tags: ['Workspace apps'], summary: 'SMS panel for a contact: number, consent, STOP opt-out and texts (contacts:read)', security: secured,
    request: { params: z.object({ contactId: z.string().uuid() }) }, responses: { 200: ok('SMS thread'), ...notFound, ...errors } });
  action('post', '/apps/twilio/consents', 'Workspace apps', 'Record that a contact agreed to texts and how; needs confirm: true; refused while they have replied STOP (contacts:write)', smsConsentSchema);
  r.registerPath({ method: 'delete', path: '/apps/twilio/consents/{contactId}', tags: ['Workspace apps'], summary: "Withdraw a contact's SMS consent (contacts:write)", security: secured,
    request: { params: z.object({ contactId: z.string().uuid() }) }, responses: { 200: ok('SMS thread'), ...errors } });
  action('post', '/apps/twilio/messages', 'Workspace apps', 'Send one SMS to one contact with recorded consent who has not replied STOP; needs confirm: true; 30 a minute (activities:write)', smsSendSchema);
  r.registerPath({ method: 'post', path: '/apps/twilio/webhooks/{hookId}/inbound', tags: ['Workspace apps'], summary: "Twilio's inbound SMS webhook for the workspace's number (form-encoded, X-Twilio-Signature with the Auth Token); STOP withdraws consent; answers empty TwiML; retries are idempotent",
    request: { params: z.object({ hookId: z.string() }) }, responses: { 200: { description: 'Empty TwiML' }, 401: { description: 'Signature check failed' }, 404: { description: 'Unknown endpoint' } } });
  r.registerPath({ method: 'post', path: '/apps/twilio/webhooks/{hookId}/status', tags: ['Workspace apps'], summary: "Twilio's status callback for texts DealFlow sent (signed); status only moves forward",
    request: { params: z.object({ hookId: z.string() }) }, responses: { 204: { description: 'Recorded' }, 401: { description: 'Signature check failed' }, 404: { description: 'Unknown endpoint' } } });
  action('get', '/emails', 'Communication', 'Synced and sent email linked to records (activities:read)', undefined, { query: z.object({ contactId: z.string().uuid().optional(), leadId: z.string().uuid().optional() }) });
  action('get', '/emails/{id}', 'Communication', 'One email with its body (activities:read)');
  action('post', '/emails/send', 'Communication', "Send one email from the caller's mailbox; daily cap applies; conversationId keeps a reply in an inbox conversation of your own mailbox (activities:write)", sendEmailSchema);
  action('get', '/inbox/threads', 'Communication', 'Inbox conversations, newest first, with filters, search and cursor paging (activities:read)', undefined, { query: inboxQuerySchema });
  action('get', '/inbox/threads/{id}', 'Communication', 'A conversation with its messages, tracking for sequence emails, and internal notes (activities:read)');
  action('patch', '/inbox/threads/{id}', 'Communication', 'Set status, category, assignee, or the linked deal, contact or lead; the assignee is notified (activities:write)', inboxUpdateSchema);
  action('post', '/inbox/threads/{id}/notes', 'Communication', 'Add an internal note; the assignee and mailbox owner are notified (activities:write)', inboxNoteSchema);
  action('get', '/inbox/sync-logs', 'Communication', 'Mailbox sync history: your own mailboxes, or all with integrations:manage (activities:read)');
  action('get', '/meeting-records', 'Meetings', 'Meeting notes, newest first, optionally for one deal, contact or lead (activities:read)', undefined, { query: z.object({ dealId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), leadId: z.string().uuid().optional() }) });
  action('get', '/meeting-records/transcription-status', 'Meetings', 'Whether recording transcription is pending configuration, configured, or verified by a successful transcription here (activities:read)');
  action('post', '/meeting-records', 'Meetings', 'Open notes for a calendar meeting (returns the existing notes if there are any) or for a call outside the calendar (activities:write)', meetingRecordCreateSchema);
  action('get', '/meeting-records/{id}', 'Meetings', 'Notes, transcript with speaker timings, the AI reading and its review state (activities:read)');
  action('patch', '/meeting-records/{id}', 'Meetings', 'Edit the title, links, notes or transcript; saving an analysis marks it reviewed by you (activities:write)', meetingRecordUpdateSchema);
  action('delete', '/meeting-records/{id}', 'Meetings', 'Delete the notes; tasks and timeline notes already created stay (activities:write)');
  action('post', '/meeting-records/{id}/recording', 'Meetings', 'Body is the audio or video file. Requires consent=true. Streamed to Deepgram and not stored; 409 PENDING_CONFIGURATION when no key is set (activities:write)', undefined, { query: z.object({ consent: z.literal('true') }) });
  action('post', '/meeting-records/{id}/analyse', 'Meetings', 'AI reading: summary, requirements, objections, decisions, action items, commitments, participants and a follow-up draft. Resets the review (activities:write, ai:use)');
  action('post', '/meeting-records/{id}/tasks', 'Meetings', 'Create tasks from reviewed action items (activities:write)', meetingTasksSchema);
  action('post', '/meeting-records/{id}/save', 'Meetings', 'Add the reviewed summary to the linked deal, contact or lead timeline, once (activities:write)');
  action('get', '/voice-notes', 'Voice notes', 'Your own voice notes, newest first, optionally for one lead, contact, deal or company (activities:write)', undefined, { query: z.object({ type: z.enum(VOICE_RECORD_TYPES).optional(), id: z.string().uuid().optional() }) });
  action('get', '/voice-notes/transcription-status', 'Voice notes', 'Pending configuration, configured, or verified by a successful transcription here; same Deepgram key as meetings (activities:write)');
  action('post', '/voice-notes', 'Voice notes', 'Start a voice note, typed or for a recording, optionally on a record you can read (activities:write)', voiceNoteCreateSchema);
  action('get', '/voice-notes/{id}', 'Voice notes', 'The note, its suggestions and what was saved from them (activities:write)');
  action('patch', '/voice-notes/{id}', 'Voice notes', 'Correct the text or language; clears the suggestions. 409 ALREADY_APPLIED once anything was saved (activities:write)', voiceNoteUpdateSchema);
  action('delete', '/voice-notes/{id}', 'Voice notes', 'Delete the note; anything already saved from it stays (activities:write)');
  action('post', '/voice-notes/{id}/recording', 'Voice notes', 'Body is the audio. Requires consent=true. Up to 25 MB, streamed to Deepgram and not stored; 409 PENDING_CONFIGURATION when no key is set (activities:write)', undefined, { query: z.object({ consent: z.literal('true') }) });
  action('post', '/voice-notes/{id}/interpret', 'Voice notes', 'AI suggestions: tasks, notes, new leads or contacts, and the last call summary when asked. Nothing is saved (activities:write, ai:use)', voiceInterpretSchema);
  action('post', '/voice-notes/{id}/apply', 'Voice notes', 'Save the suggestions you confirmed, as edited, through the normal task, note, lead and contact rules (activities:write plus leads:write or contacts:write where needed)', voiceApplySchema);
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
  action('post', '/ai/email/draft', 'AI', 'Email Assistant: draft a first email, follow-up or reply from the record, or a template with merge fields; never sends (ai:use)', emailDraftRequestSchema);
  action('post', '/ai/email/rewrite', 'AI', 'Email Assistant: improve, shorten or change the tone; merge fields must survive unchanged (ai:use)', emailRewriteRequestSchema);
  action('post', '/ai/email/subjects', 'AI', 'Email Assistant: suggest subject lines (ai:use)', emailSubjectsRequestSchema);
  action('post', '/ai/email/analyse', 'AI', 'Email Assistant: read a received email for intent, objections, buying signals, next step and a suggested reply; stores the intent on the email (ai:use, activities:read)', emailAnalyseRequestSchema);
  action('get', '/ai/email/analysis/{emailId}', 'AI', 'Latest Email Assistant reading of an email (ai:use, activities:read)', undefined, { params: z.object({ emailId: z.string().uuid() }) });
  action('post', '/ai/workflows/draft', 'AI', 'Turn a description into a validated workflow definition; not saved (ai:use, automation:manage)', workflowDraftRequestSchema);
  action('get', '/ai/recommendations', 'AI', 'Agent results for a record (ai:use)', undefined, { query: z.object({ entityType: z.enum(['lead', 'contact', 'deal']), entityId: z.string().uuid() }) });
  action('post', '/ai/recommendations/{id}/accept', 'AI', 'Accept: creates the task or note as the caller (ai:use)', acceptNextStepSchema);
  action('post', '/ai/recommendations/{id}/dismiss', 'AI', 'Dismiss (ai:use)');
  action('post', '/ai/recommendations/{id}/tasks', 'AI', 'Create tasks from chosen meeting action items (ai:use, activities:write)', createActionItemsSchema);
  action('post', '/ai/forecast/explain', 'AI', 'Snapshot comparison with a written explanation (ai:use, dashboard:read, deals:read)', z.object({ from: z.string().uuid(), to: z.string().uuid() }));
  action('get', '/forecast', 'Forecasting', 'Weighted forecast for a month, quarter or year; rule-based, no AI (dashboard:read, deals:read)', undefined, { query: forecastQuerySchema });
  action('get', '/forecast/snapshots', 'Forecasting', 'Snapshots for a period (dashboard:read, deals:read)', undefined, { query: forecastQuerySchema });
  r.registerPath({ method: 'post', path: '/forecast/snapshots', tags: ['Forecasting'], summary: 'Store an immutable snapshot with its lines (dashboard:read, deals:read)', security: secured,
    request: body(snapshotInputSchema), responses: { 201: ok('Snapshot'), ...errors } });
  r.registerPath({ method: 'get', path: '/forecast/snapshots/{id}/verify', tags: ['Forecasting'], summary: 'Recompute totals from the stored lines (dashboard:read, deals:read)', security: secured,
    request: { params: idParam }, responses: { 200: ok('Stored and recomputed totals'), ...notFound, ...errors } });
  action('get', '/forecast/plan', 'Forecasting', 'Target, attainment, gap per scenario, coverage, per-salesperson targets and gaps, risks in the period and stage win rates. period: YYYY, YYYY-Qn or YYYY-MM (dashboard:read, deals:read)', undefined, { query: forecastQuerySchema });
  action('get', '/forecast/trends', 'Forecasting', 'Won revenue, win rate, cycle, loss reasons and first-snapshot accuracy per month, quarter or year (dashboard:read, deals:read)', undefined, { query: z.object({ granularity: z.enum(['month', 'quarter', 'year']).optional(), count: z.number().int().min(2).max(24).optional() }) });
  action('get', '/forecast/settings', 'Forecasting', 'How probabilities and categories are worked out (dashboard:read, deals:read)');
  action('put', '/forecast/settings', 'Forecasting', 'Change the probability method (stage or stage win history) and category thresholds (pipelines:manage)', forecastSettingsSchema);
  action('get', '/forecast/compare', 'Forecasting', 'Deal-level changes between two snapshots (dashboard:read, deals:read)', undefined, { query: z.object({ from: z.string().uuid(), to: z.string().uuid() }) });

  // Enhancement feature 11: client self-service portal (ADR 0025). Workspace routes need a member session;
  // /client-portal routes use the separate portal session cookie (df_portal) and never accept a member session.
  action('get', '/portal/settings', 'Client portal', 'Portal address, on/off and what customers can see and do (companies:read)');
  action('put', '/portal/settings', 'Client portal', 'Change portal settings; the address must be unused (tenant:manage)', portalSettingsSchema);
  action('get', '/portal/users', 'Client portal', 'People with portal access, optionally for one company (companies:read)', undefined, { query: z.object({ companyId: z.string().uuid().optional() }) });
  action('post', '/portal/users', 'Client portal', 'Invite someone at a company; returns a 7-day invitation link and whether it was emailed (companies:write)', portalInviteSchema);
  action('patch', '/portal/users/{id}', 'Client portal', 'Change access (viewer or approver) or switch access off, which ends their sessions (companies:write)', portalUserUpdateSchema);
  action('post', '/portal/users/{id}/invitation', 'Client portal', 'A new invitation link for someone who has not accepted (companies:write)');
  action('delete', '/portal/users/{id}', 'Client portal', 'Remove portal access; messages and requests stay (companies:write)');
  action('get', '/portal/companies/{id}', 'Client portal', 'One company: people, shared documents, messages, tasks that can be shared and requests (companies:read)');
  action('post', '/portal/companies/{id}/messages', 'Client portal', 'Message the customer (companies:write)', portalMessageSchema);
  action('post', '/portal/companies/{id}/documents', 'Client portal', 'Share a file with the customer: raw body, Content-Type of the file, ?name=; PDF, image, text, CSV or Office, up to 10 MB (companies:write)', undefined, { query: z.object({ name: z.string() }) });
  action('delete', '/portal/documents/{id}', 'Client portal', 'Stop sharing a document (companies:write)');
  action('get', '/portal/documents/{id}/download', 'Client portal', 'Download a portal document (companies:read)');
  action('put', '/portal/tasks/{id}/visibility', 'Client portal', 'Show or hide a task as a milestone in the portal (activities:write)', z.object({ visible: z.boolean() }));
  action('get', '/portal/requests', 'Client portal', 'Requests from customers; status=active|open|in_progress|resolved|closed, mine=true (companies:read)', undefined, { query: z.object({ status: z.string().optional(), mine: z.enum(['true', 'false']).optional() }) });
  action('get', '/portal/requests/{id}', 'Client portal', 'One request with its messages (companies:read)');
  action('patch', '/portal/requests/{id}', 'Client portal', 'Change status or assignee (companies:write)', portalRequestUpdateSchema);
  action('post', '/portal/requests/{id}/messages', 'Client portal', 'Reply to the customer (companies:write)', portalMessageSchema);
  for (const [method, path, summary, schema] of [
    ['get', '/client-portal/portals/{slug}', 'Public: portal name, seller and branding (404 when off)', undefined],
    ['post', '/client-portal/portals/{slug}/login', 'Public: sign in; sets the df_portal cookie. Five wrong passwords lock the account for 15 minutes', portalLoginSchema],
    ['post', '/client-portal/portals/{slug}/password/forgot', 'Public: email a 60-minute reset link; answers the same whether or not the email has access', portalForgotSchema],
    ['post', '/client-portal/invitations/accept', 'Public: choose a password from an invitation and sign in', portalAcceptSchema],
    ['post', '/client-portal/password/reset', 'Public: set a new password from a reset link; ends every other session', portalResetSchema],
    ['post', '/client-portal/logout', 'Portal session: sign out', undefined],
    ['get', '/client-portal/me', 'Portal session: who is signed in, their company, account manager, branding and enabled sections', undefined],
    ['get', '/client-portal/dashboard', 'Portal session: projects with progress, proposals, contracts, shared milestones, updates; invoices are reported as not connected', undefined],
    ['post', '/client-portal/updates/seen', 'Portal session: mark updates as seen', undefined],
    ['get', '/client-portal/proposals/{id}', 'Portal session: a sent, accepted or declined proposal for the customer\'s company', undefined],
    ['post', '/client-portal/proposals/{id}/decision', 'Portal session: approve or decline a sent proposal (approvers only, when approvals are on)', portalDecisionSchema],
    ['get', '/client-portal/requests', 'Portal session: the company\'s requests', undefined],
    ['post', '/client-portal/requests', 'Portal session: open a request; assigned to the company owner', portalRequestCreateSchema],
    ['get', '/client-portal/requests/{id}', 'Portal session: one request with messages', undefined],
    ['post', '/client-portal/requests/{id}/messages', 'Portal session: reply; re-opens a resolved request, refused when closed', portalMessageSchema],
    ['get', '/client-portal/messages', 'Portal session: messages with the account team', undefined],
    ['post', '/client-portal/messages', 'Portal session: send a message', portalMessageSchema],
    ['get', '/client-portal/documents', 'Portal session: shared documents with 10-minute signed download links', undefined],
    ['post', '/client-portal/documents', 'Portal session: upload a file (raw body, ?name=), when uploads are on', undefined],
    ['get', '/client-portal/documents/download/{token}', 'Signed link: download a document; expires after 10 minutes', undefined],
  ] as const) {
    r.registerPath({ method, path, tags: ['Client portal'], summary, ...(schema ? { request: body(schema) } : {}), responses: { 200: ok('OK'), ...errors } });
  }

  // Phase 5: catalogue, quotes, contracts, marketing, revenue analytics and customer success.
  action('get', '/catalog/products', 'Catalogue', 'Products with their prices per price book (quotes:read)');
  action('post', '/catalog/products', 'Catalogue', 'Create a product (catalog:manage)', productInputSchema);
  action('put', '/catalog/products/{id}', 'Catalogue', 'Update a product (catalog:manage)', productInputSchema);
  action('get', '/catalog/price-books', 'Catalogue', 'Price books (quotes:read)');
  action('post', '/catalog/price-books', 'Catalogue', 'Create a price book; one default per currency (catalog:manage)', priceBookInputSchema);
  action('put', '/catalog/price-books/{id}', 'Catalogue', 'Update a price book (catalog:manage)', priceBookInputSchema);
  r.registerPath({ method: 'put', path: '/catalog/price-books/{id}/prices/{productId}', tags: ['Catalogue'], summary: 'Set a unit price; audited as price.changed (catalog:manage)', security: secured,
    request: { params: z.object({ id: z.string().uuid(), productId: z.string().uuid() }), ...body(z.object({ unitPrice: z.number().min(0) })) }, responses: { 204: ok('Saved'), ...notFound, ...errors } });
  action('get', '/catalog/tax-rates', 'Catalogue', 'Tax rates (quotes:read)');
  action('post', '/catalog/tax-rates', 'Catalogue', 'Create a tax rate (catalog:manage)', taxRateInputSchema);
  action('put', '/catalog/tax-rates/{id}', 'Catalogue', 'Update a tax rate (catalog:manage)', taxRateInputSchema);
  action('get', '/catalog/settings', 'Catalogue', 'Discount approval threshold and quote validity (quotes:read)');
  r.registerPath({ method: 'patch', path: '/catalog/settings', tags: ['Catalogue'], summary: 'Update quote rules (catalog:manage)', security: secured, request: body(commercialSettingsSchema), responses: { 200: ok('Settings'), ...errors } });
  action('get', '/quotes', 'Quotes', 'Latest version of each quote (quotes:read)', undefined, { query: z.object({ opportunityId: z.string().uuid().optional(), status: z.string().optional() }) });
  r.registerPath({ method: 'post', path: '/quotes', tags: ['Quotes'], summary: 'Create a draft; prices come from the price book (quotes:write)', security: secured, request: body(quoteInputSchema), responses: { 201: ok('Quote'), ...errors } });
  action('get', '/quotes/{id}', 'Quotes', 'Quote with lines and totals (quotes:read)');
  action('get', '/quotes/{id}/versions', 'Quotes', 'Every version of this quote number (quotes:read)');
  r.registerPath({ method: 'patch', path: '/quotes/{id}', tags: ['Quotes'], summary: 'Edit a draft or rejected quote (quotes:write)', security: secured, request: { params: idParam, ...body(quoteUpdateSchema) }, responses: { 200: ok('Quote'), ...notFound, ...errors } });
  action('post', '/quotes/{id}/transition', 'Quotes', 'submit, mark_sent, accept, decline or revise; discounts above the threshold go to the approvals inbox (quotes:write)', quoteTransitionSchema);
  r.registerPath({ method: 'delete', path: '/quotes/{id}', tags: ['Quotes'], summary: 'Delete a first-version draft (quotes:write)', security: secured, request: { params: idParam }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });
  action('post', '/quotes/{id}/send', 'Quotes', 'Email an approved or sent proposal from your mailbox with its online link; marks an approved quote as sent (quotes:write, activities:write)', proposalSendSchema);
  action('get', '/quotes/{id}/share', 'Quotes', 'Whether the online proposal link is live, and the link (quotes:read)');
  action('post', '/quotes/{id}/share', 'Quotes', 'Turn the online proposal link on or off; only approved, sent, accepted or declined quotes (quotes:write)', z.object({ enabled: z.boolean() }));
  r.registerPath({ method: 'get', path: '/proposals/view/{token}', tags: ['Quotes'], summary: 'Public: the online proposal; each load counts as a view unless preview=1 (no auth)', request: { params: z.object({ token: z.string() }), query: z.object({ preview: z.literal('1').optional() }) }, responses: { 200: ok('Proposal'), 404: json(error, 'Not shared or not valid') } });
  r.registerPath({ method: 'post', path: '/proposals/view/{token}/pay', tags: ['Quotes'], summary: "Public: open the seller's hosted Stripe or Razorpay payment page for an accepted, latest proposal; 10 a minute (no auth)", request: { params: z.object({ token: z.string() }) }, responses: { 200: ok('{ url } of the hosted payment page'), 404: json(error, 'Not shared or not valid'), 409: json(error, 'PAYMENTS_OFF, CANNOT_PAY, ALREADY_PAID or PAYMENT_UNAVAILABLE') } });
  r.registerPath({ method: 'get', path: '/proposals/view/{token}/pdf', tags: ['Quotes'], summary: 'Public: the proposal as a PDF; not counted as a view (no auth)', request: { params: z.object({ token: z.string() }) }, responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, 404: json(error, 'Not shared or not valid') } });
  r.registerPath({ method: 'get', path: '/quotes/{id}/pdf', tags: ['Quotes'], summary: 'PDF of the quote (quotes:read)', security: secured, request: { params: idParam },
    responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: z.string() } } }, ...notFound, ...errors } });
  action('get', '/contracts', 'Contracts', 'Contracts (contracts:read)', undefined, { query: z.object({ status: z.string().optional(), companyId: z.string().uuid().optional(), renewalWithinDays: z.number().int().optional() }) });
  r.registerPath({ method: 'post', path: '/contracts', tags: ['Contracts'], summary: 'Create a draft, optionally from an accepted quote (contracts:write)', security: secured, request: body(contractInputSchema), responses: { 201: ok('Contract'), ...errors } });
  action('get', '/contracts/{id}', 'Contracts', 'Contract (contracts:read)');
  r.registerPath({ method: 'patch', path: '/contracts/{id}', tags: ['Contracts'], summary: 'Update; signed value, terms and start date are fixed (contracts:write)', security: secured, request: { params: idParam, ...body(contractUpdateSchema) }, responses: { 200: ok('Contract'), ...notFound, ...errors } });
  action('post', '/contracts/{id}/sign', 'Contracts', 'Record who signed, when and how; no e-signature provider is connected (contracts:write)', contractSignSchema);
  action('post', '/contracts/{id}/terminate', 'Contracts', 'Terminate an active contract (contracts:write)', contractTerminateSchema);
  action('post', '/contracts/{id}/renew', 'Contracts', 'Start a linked renewal for the next term (contracts:write)');
  action('get', '/segments', 'Marketing', 'Saved segments (marketing:read)');
  r.registerPath({ method: 'post', path: '/segments', tags: ['Marketing'], summary: 'Save a segment (marketing:manage)', security: secured, request: body(segmentInputSchema), responses: { 201: ok('Segment'), ...errors } });
  action('put', '/segments/{id}', 'Marketing', 'Update a segment (marketing:manage)', segmentInputSchema);
  r.registerPath({ method: 'delete', path: '/segments/{id}', tags: ['Marketing'], summary: 'Delete a segment (marketing:manage)', security: secured, request: { params: idParam }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });
  action('post', '/segments/preview', 'Marketing', 'Count and sample members with consent counts (marketing:read)', z.object({ entity: z.enum(['lead', 'contact']), rules: segmentRulesSchema }));
  action('get', '/segments/{id}/preview', 'Marketing', 'Preview a saved segment (marketing:read)');
  r.registerPath({ method: 'get', path: '/segments/{id}/export', tags: ['Marketing'], summary: 'CSV of members; never includes opted-out people; audited (marketing:read, data:export)', security: secured,
    request: { params: idParam, query: z.object({ optedInOnly: z.enum(['true', 'false']).optional() }) }, responses: { 200: { description: 'CSV', content: { 'text/csv': { schema: z.string() } } }, ...notFound, ...errors } });
  action('get', '/forms', 'Marketing', 'Hosted lead forms (marketing:read)');
  r.registerPath({ method: 'post', path: '/forms', tags: ['Marketing'], summary: 'Create a hosted lead form (marketing:manage)', security: secured, request: body(leadFormInputSchema), responses: { 201: ok('Form'), ...errors } });
  action('put', '/forms/{id}', 'Marketing', 'Update a form (marketing:manage)', leadFormInputSchema);
  action('get', '/forms/{id}/submissions', 'Marketing', 'Latest 50 submissions (marketing:read, leads:read)');
  // Phase 9: email templates and sequences
  action('get', '/email-templates', 'Sequences', 'Your templates and shared ones, optionally by category or campaign (sequences:read)', undefined, { query: z.object({ category: z.string().max(40).optional(), campaignId: z.string().uuid().optional() }) });
  action('get', '/email-templates/categories', 'Sequences', 'Categories in use on templates you can see (sequences:read)');
  r.registerPath({ method: 'post', path: '/email-templates/{id}/duplicate', tags: ['Sequences'], summary: 'Copy a template as a private "(copy)" (sequences:write)', security: secured, request: { params: idParam }, responses: { 201: ok('Template'), ...notFound, ...errors } });
  action('get', '/email-variables', 'Sequences', 'Workspace email variables, used as {{var.key}} (sequences:read)');
  action('put', '/email-variables', 'Sequences', 'Create or change a workspace variable, up to 50 (marketing:manage)', emailVariableInputSchema);
  r.registerPath({ method: 'delete', path: '/email-variables/{key}', tags: ['Sequences'], summary: 'Delete a variable no template or live sequence uses (marketing:manage)', security: secured, request: { params: z.object({ key: z.string() }) }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });
  action('get', '/sequences/analytics', 'Sequences', 'Sequence email results by sequence, mailbox, template and follow-up position; opens are estimates; team scope needs marketing:manage (sequences:read)', undefined, { query: z.object({ days: z.number().int().min(1).max(365).optional(), scope: z.enum(['mine', 'team']).optional() }) });
  r.registerPath({ method: 'post', path: '/email-templates', tags: ['Sequences'], summary: 'Create a template; sharing needs marketing:manage (sequences:write)', security: secured, request: body(emailTemplateInputSchema), responses: { 201: ok('Template'), ...errors } });
  action('put', '/email-templates/{id}', 'Sequences', 'Update a template (owner or marketing:manage)', emailTemplateInputSchema);
  r.registerPath({ method: 'delete', path: '/email-templates/{id}', tags: ['Sequences'], summary: 'Delete a template not used by a sequence (sequences:write)', security: secured, request: { params: idParam }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });
  action('post', '/email-templates/preview', 'Sequences', 'Render a subject and body for a lead or contact, listing empty merge fields (sequences:read)', templatePreviewSchema);
  action('get', '/sequences', 'Sequences', 'Sequences with totals (sequences:read)');
  r.registerPath({ method: 'post', path: '/sequences', tags: ['Sequences'], summary: 'Create a draft sequence (sequences:write)', security: secured, request: body(sequenceInputSchema), responses: { 201: ok('Sequence'), ...errors } });
  action('get', '/sequences/{id}', 'Sequences', 'Sequence (sequences:read)');
  action('put', '/sequences/{id}', 'Sequences', 'Update steps, rules and sending settings (owner or marketing:manage)', sequenceInputSchema);
  action('post', '/sequences/{id}/status', 'Sequences', 'Start, pause or archive (owner or marketing:manage)', sequenceStatusSchema);
  action('post', '/sequences/{id}/enroll', 'Sequences', 'Enrol leads, contacts or a segment; emails go from the caller\'s own mailbox (sequences:write)', enrollInputSchema);
  action('get', '/sequences/{id}/step-stats', 'Sequences', 'Sent, replied, opened, clicked and bounced per email step, and per version for A/B-tested steps (sequences:read)');
  action('post', '/sequences/{id}/test-send', 'Sequences', "Send one email of the sequence (version A or B) to the caller's own mailbox, filled in for a chosen lead or contact; not tracked (sequences:write)", sequenceTestSendSchema);
  action('get', '/sequences/enrollments', 'Sequences', 'Enrolments by sequence, lead or contact (sequences:read)', undefined, { query: z.object({ sequenceId: z.string().uuid().optional(), leadId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), status: z.enum(['live', 'finished']).optional() }) });
  action('post', '/sequences/enrollments/{id}', 'Sequences', 'Pause, resume or stop one run (sender or marketing:manage)', z.object({ action: z.enum(['pause', 'resume', 'stop']) }));
  action('get', '/sequences/suppressions', 'Sequences', 'The do-not-email list (sequences:read)');
  action('post', '/sequences/suppressions', 'Sequences', 'Add addresses to the do-not-email list (sequences:write)', suppressionInputSchema);
  // Phase 9: browser extension. Connections are managed with the web session; the rest takes the extension's dfx_ bearer token only.
  action('get', '/extension/connections', 'Browser extension', 'Your extension connections (web session only)');
  r.registerPath({ method: 'post', path: '/extension/connections', tags: ['Browser extension'], summary: 'Create a connection; the dfx_ code is returned once (web session only, at most 5)', security: secured, request: body(extensionTokenCreateSchema), responses: { 201: ok('Connection and code'), ...errors } });
  r.registerPath({ method: 'delete', path: '/extension/connections/{id}', tags: ['Browser extension'], summary: 'End a connection (web session only)', security: secured, request: { params: idParam }, responses: { 204: ok('Ended'), ...notFound, ...errors } });
  action('get', '/extension/me', 'Browser extension', 'Who the extension is signed in as, what it may do, and running sequences (extension token)');
  action('post', '/extension/lookup', 'Browser extension', 'Match addresses and a website against leads, contacts, companies and the do-not-email list (leads:read, extension token)', extensionLookupSchema);
  action('post', '/extension/capture', 'Browser extension', 'Save up to 25 people as leads, skipping anyone already in DealFlow, and optionally enrol them (leads:write, extension token)', extensionCaptureSchema);
  action('post', '/extension/disconnect', 'Browser extension', 'The extension ends its own connection (extension token)');
  // Phase 9: email finder (own website reader; optional Hunter.io key).
  action('post', '/finder/search', 'Email finder', 'Find a company’s website and work addresses, or a person’s likely address; counts toward FINDER_DAILY_LIMIT (leads:read)', finderSearchSchema);
  action('get', '/finder/usage', 'Email finder', 'Lookups used in the last 24 hours, the limit, and whether a provider is connected (leads:read)');
  action('get', '/finder/lookups', 'Email finder', 'Your 20 most recent lookups (leads:read)');
  action('get', '/finder/lookups/{id}', 'Email finder', 'One of your lookups, with current "already in DealFlow" marks (leads:read)');
  action('post', '/finder/lookups/{id}/save', 'Email finder', 'Save chosen people as leads (source "Email finder"), optionally enrolling them (leads:write)', finderSaveSchema);
  action('post', '/extension/find', 'Browser extension', 'Run the email finder for the domain the extension is on (leads:read, extension token)', z.object({ domain: z.string() }));
  r.registerPath({ method: 'get', path: '/t/o/{token}', tags: ['Sequences'], summary: 'Public: open-tracking image (signed token, no auth)', request: { params: z.object({ token: z.string() }) }, responses: { 200: { description: 'GIF', content: { 'image/gif': { schema: z.string() } } } } });
  r.registerPath({ method: 'get', path: '/t/c/{token}', tags: ['Sequences'], summary: 'Public: signed click redirect (no auth)', request: { params: z.object({ token: z.string() }), query: z.object({ u: z.string(), s: z.string() }) }, responses: { 302: { description: 'Redirect to the signed URL' }, 400: json(error, 'Invalid link') } });
  r.registerPath({ method: 'post', path: '/t/u/{token}', tags: ['Sequences'], summary: 'Public: unsubscribe, including RFC 8058 one-click (no auth)', request: { params: z.object({ token: z.string() }) }, responses: { 200: ok('Unsubscribe result') } });
  r.registerPath({ method: 'get', path: '/public/forms/{token}', tags: ['Marketing'], summary: 'Public: what the hosted form page shows (no auth)', request: { params: z.object({ token: z.string() }) }, responses: { 200: ok('Form view'), 404: json(error, 'Not available') } });
  r.registerPath({ method: 'post', path: '/public/forms/{token}', tags: ['Marketing'], summary: 'Public: submit a form; 5 per address per 10 minutes (no auth)', request: { params: z.object({ token: z.string() }), ...body(z.record(z.unknown())) },
    responses: { 200: ok('Thank-you message'), 400: json(error, 'Validation failed'), 404: json(error, 'Not available'), 429: json(error, 'Rate limited') } });
  action('get', '/campaigns', 'Marketing', 'Campaigns with first-touch results (marketing:read)');
  action('get', '/campaigns/{id}', 'Marketing', 'Campaign with results (marketing:read)');
  r.registerPath({ method: 'post', path: '/campaigns', tags: ['Marketing'], summary: 'Create a campaign (marketing:manage)', security: secured, request: body(campaignInputSchema), responses: { 201: ok('Campaign'), ...errors } });
  action('put', '/campaigns/{id}', 'Marketing', 'Update a campaign (marketing:manage)', campaignInputSchema);
  action('get', '/analytics/revenue', 'Revenue', 'Quarter revenue analytics in the workspace currency (dashboard:read, deals:read)', undefined, { query: z.object({ period: z.string().optional() }) });
  action('get', '/analytics/exchange-rates', 'Revenue', 'Manually entered exchange rates (dashboard:read)');
  action('put', '/analytics/exchange-rates', 'Revenue', 'Add a rate for a date (catalog:manage)', exchangeRateInputSchema);
  action('get', '/analytics/targets', 'Revenue', 'Sales targets (dashboard:read)', undefined, { query: z.object({ period: z.string().optional() }) });
  action('put', '/analytics/targets', 'Revenue', 'Set a team or personal target (pipelines:manage)', salesTargetInputSchema);
  r.registerPath({ method: 'delete', path: '/analytics/targets/{id}', tags: ['Revenue'], summary: 'Remove a target (pipelines:manage)', security: secured, request: { params: idParam }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });
  action('get', '/success/customers', 'Customer success', 'Customers with explained health scores, churn risk, engagement, deal history, score history and a rule-based retention plan; filter by band and owner (success:read, companies:read)', undefined, { query: z.object({ band: z.enum(['healthy', 'watch', 'at_risk']).optional(), ownerId: z.string().uuid().optional() }) });
  action('get', '/success/trends', 'Customer success', 'Customers by churn risk per day and the biggest falls over 30, 90 or 180 days (success:read, companies:read)', undefined, { query: z.object({ days: z.enum(['30', '90', '180']).optional() }) });
  action('post', '/success/customers/{companyId}/follow-ups', 'Customer success', 'Create the follow-up tasks the manager confirmed, due 09:00 their time, optionally on a contact at the customer (success:write, activities:write)', customerFollowUpsSchema);
  action('post', '/success/customers/{companyId}/retention-brief', 'Customer success', 'Retention Advisor draft: summary, talking points and steps from the health facts. Creates nothing (success:read, companies:read, ai:use)');
  r.registerPath({ method: 'get', path: '/success/customers/{companyId}', tags: ['Customer success'], summary: 'One customer; 404 without an active contract (success:read, companies:read)', security: secured,
    request: { params: z.object({ companyId: z.string().uuid() }) }, responses: { 200: ok('Customer'), ...notFound, ...errors } });
  action('get', '/success/escalations', 'Customer success', 'Escalations (success:read)', undefined, { query: z.object({ status: z.enum(['OPEN', 'RESOLVED']).optional(), companyId: z.string().uuid().optional() }) });
  r.registerPath({ method: 'post', path: '/success/escalations', tags: ['Customer success'], summary: 'Open an escalation (success:write)', security: secured, request: body(escalationInputSchema), responses: { 201: ok('Escalation'), ...errors } });
  action('post', '/success/escalations/{id}/resolve', 'Customer success', 'Resolve with a note (success:write)', escalationResolveSchema);

  // Enhancement feature 14: sales gamification and sales teams.
  action('get', '/gamification/me', 'Gamification', 'Your points this month, rank, target progress, badges and competitions; enabled:false while gamification is off (gamification:read)');
  action('get', '/gamification/leaderboard', 'Gamification', 'People and teams ranked by points for a month, quarter or year (default this month), from CRM records under the workspace rules. 409 GAMIFICATION_OFF when off; managers-only visibility shows others just themselves (gamification:read)', undefined, { query: z.object({ period: z.string().optional() }) });
  action('get', '/gamification/settings', 'Gamification', 'Whether gamification is on, who sees leaderboards, and the scoring rules with daily limits (gamification:read)');
  action('put', '/gamification/settings', 'Gamification', 'Turn gamification on or off, set leaderboard visibility and the scoring rules; audited (gamification:manage)', gamificationSettingsSchema);
  action('get', '/gamification/badges', 'Gamification', 'Badges with their rule and how often each was awarded (gamification:read)');
  r.registerPath({ method: 'post', path: '/gamification/badges', tags: ['Gamification'], summary: 'Create a badge (gamification:manage)', security: secured, request: body(badgeInputSchema), responses: { 201: ok('Badge'), ...errors } });
  r.registerPath({ method: 'post', path: '/gamification/badges/defaults', tags: ['Gamification'], summary: 'Add the suggested badges that are missing, matched by name (gamification:manage)', security: secured, responses: { 201: ok('Badges'), ...errors } });
  action('post', '/gamification/badges/evaluate', 'Gamification', 'Award badges now instead of waiting for the hourly worker; returns how many were awarded (gamification:manage)');
  action('put', '/gamification/badges/{id}', 'Gamification', 'Update a badge; awards already given are kept (gamification:manage)', badgeInputSchema);
  r.registerPath({ method: 'delete', path: '/gamification/badges/{id}', tags: ['Gamification'], summary: 'Delete a badge and its awards (gamification:manage)', security: secured, request: { params: idParam }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });
  action('get', '/gamification/awards', 'Gamification', 'Recent badge awards; your own only when leaderboards are for managers (gamification:read)');
  action('get', '/gamification/competitions', 'Gamification', 'Competitions and team challenges with standings, scored with the rules copied at creation (gamification:read)');
  r.registerPath({ method: 'post', path: '/gamification/competitions', tags: ['Gamification'], summary: 'Start a competition or team challenge for a period or custom dates; participants are notified in DealFlow (gamification:manage)', security: secured, request: body(competitionInputSchema), responses: { 201: ok('Competition'), ...errors } });
  action('post', '/gamification/competitions/{id}/cancel', 'Gamification', 'Cancel a competition (gamification:manage)');
  action('get', '/tenants/current/teams', 'Tenants', 'Sales teams and their active members (members:read)');
  r.registerPath({ method: 'post', path: '/tenants/current/teams', tags: ['Tenants'], summary: 'Create a sales team from active members (members:manage)', security: secured, request: body(teamInputSchema), responses: { 201: ok('Team'), ...errors } });
  action('put', '/tenants/current/teams/{id}', 'Tenants', 'Rename a team and replace its members (members:manage)', teamInputSchema);
  r.registerPath({ method: 'delete', path: '/tenants/current/teams/{id}', tags: ['Tenants'], summary: 'Delete a sales team (members:manage)', security: secured, request: { params: idParam }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });

  // Enhancement feature 15: website visitor intelligence.
  action('get', '/visitors/settings', 'Visitors', 'Tracking on or off, consent mode, allowed websites, retention, important pages and the public site key (visitors:read)');
  action('put', '/visitors/settings', 'Visitors', 'Change tracking settings; turning tracking on needs at least one allowed website; audited (visitors:manage)', visitorSettingsSchema);
  action('post', '/visitors/settings/rotate-key', 'Visitors', 'Issue a new site key; the old snippet stops working (visitors:manage)');
  action('get', '/visitors/dashboard', 'Visitors', 'Visits, important pages, sources, campaigns and high-intent visitors for the last 7, 30 or 90 days (visitors:read)', undefined, { query: z.object({ days: z.coerce.number().optional() }) });
  action('get', '/visitors/record', 'Visitors', 'Website activity linked to a lead or contact (visitors:read)', undefined, { query: z.object({ type: z.enum(['lead', 'contact']), id: z.string().uuid() }) });
  action('get', '/visitors', 'Visitors', 'Visitors, newest first; segment all, identified, anonymous or high_intent (visitors:read)', undefined, { query: z.object({ segment: z.string().optional(), search: z.string().optional() }) });
  action('get', '/visitors/{id}', 'Visitors', 'One visitor with sessions, pages and the intent signals behind the score (visitors:read)');
  r.registerPath({ method: 'delete', path: '/visitors/{id}', tags: ['Visitors'], summary: 'Erase a visitor and all their page views; the linked lead or contact is kept; audited (visitors:manage)', security: secured, request: { params: idParam }, responses: { 204: ok('Erased'), ...notFound, ...errors } });
  r.registerPath({ method: 'get', path: '/public/track/script.js', tags: ['Visitors'], summary: 'Public: the first-party tracking script. Honours Global Privacy Control and Do Not Track; no cookies or fingerprinting (no auth)', responses: { 200: { description: 'JavaScript', content: { 'application/javascript': { schema: z.string() } } } } });
  r.registerPath({ method: 'get', path: '/public/track/{siteKey}/config', tags: ['Visitors'], summary: 'Public: consent mode and enquiry consent text for an allowed website; 404 when tracking is off or the origin is not allowed (no auth)', request: { params: z.object({ siteKey: z.string() }) }, responses: { 200: ok('Config'), 404: json(error, 'Not available') } });
  r.registerPath({ method: 'post', path: '/public/track/{siteKey}/collect', tags: ['Visitors'], summary: 'Public: record page views, custom events and engaged time; requests with a privacy signal are dropped (no auth)', request: { params: z.object({ siteKey: z.string() }), ...body(collectSchema) }, responses: { 200: ok('Stored count'), 404: json(error, 'Not available') } });
  r.registerPath({ method: 'post', path: '/public/track/{siteKey}/enquiry', tags: ['Visitors'], summary: 'Public: an enquiry from the website; links to a contact or open lead by email or creates a lead; 5 per address per 10 minutes (no auth)', request: { params: z.object({ siteKey: z.string() }), ...body(enquirySchema) }, responses: { 200: ok('Thank-you message'), 404: json(error, 'Not available'), 429: json(error, 'Too many enquiries') } });

  // Part 2: Prospect Lists and prospect discovery (Apollo.io search, Hunter.io verification; Mock Mode without keys).
  action('get', '/prospect-lists', 'Prospects', 'Prospect lists with counts, owner and assignee (prospects:read)');
  r.registerPath({ method: 'post', path: '/prospect-lists', tags: ['Prospects'], summary: 'Create a named list; the assignee is notified in DealFlow (prospects:write)', security: secured, request: body(prospectListInputSchema), responses: { 201: ok('List'), ...errors } });
  action('get', '/prospect-lists/{id}', 'Prospects', 'A page of prospects with search, filters (industry, country, company size, title, email status, stage, source), sort and facets (prospects:read)', undefined, { query: z.object({ search: z.string().optional(), industry: z.string().optional(), country: z.string().optional(), companySize: z.string().optional(), title: z.string().optional(), emailStatus: z.string().optional(), stage: z.string().optional(), source: z.string().optional(), sort: z.string().optional(), page: z.number().int().optional() }) });
  action('put', '/prospect-lists/{id}', 'Prospects', 'Rename, describe or assign a list; audited (prospects:write)', prospectListInputSchema);
  r.registerPath({ method: 'delete', path: '/prospect-lists/{id}', tags: ['Prospects'], summary: 'Delete a list and its prospects; leads and contacts are kept (prospects:write)', security: secured, request: { params: idParam }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });
  r.registerPath({ method: 'post', path: '/prospect-lists/{id}/prospects', tags: ['Prospects'], summary: 'Add people by hand; duplicates in the list are skipped and people already in the CRM are linked (prospects:write)', security: secured, request: { params: idParam, ...body(prospectAddSchema) }, responses: { 201: ok('Added, duplicates, in CRM'), ...errors } });
  r.registerPath({ method: 'post', path: '/prospect-lists/{id}/import', tags: ['Prospects'], summary: 'Upload a .csv or .xlsx file (raw body, ?name=, up to 5 MB and 5,000 rows); returns its columns and a suggested mapping (prospects:write)', security: secured, request: { params: idParam, query: z.object({ name: z.string() }) }, responses: { 201: ok('Import preview'), ...errors } });
  r.registerPath({ method: 'post', path: '/prospect-lists/{id}/import/{importId}', tags: ['Prospects'], summary: 'Import the uploaded file with a column mapping; reports bad rows and duplicates (prospects:write)', security: secured, request: { params: z.object({ id: z.string().uuid(), importId: z.string().uuid() }), ...body(prospectImportCommitSchema) }, responses: { 200: ok('Import result'), ...notFound, ...errors } });
  action('post', '/prospect-lists/{id}/dedupe', 'Prospects', 'Remove duplicates (same email, or same name at the same company), keeping the most complete copy (prospects:write)');
  action('get', '/prospect-lists/{id}/performance', 'Prospects', 'Outreach results for sequences this list was sent to: enrolled, sent, opened, clicked, replied, bounced, unsubscribed (prospects:read)');
  r.registerPath({ method: 'get', path: '/prospect-lists/{id}/export', tags: ['Prospects'], summary: 'CSV of eligible prospects only (not sample data, has an email that is not invalid, bounced or on the do-not-email list); audited (prospects:export)', security: secured, request: { params: idParam }, responses: { 200: { description: 'CSV', content: { 'text/csv': { schema: z.string() } } }, ...notFound, ...errors } });
  action('post', '/prospect-lists/{id}/provider', 'Prospects', 'Add people from a provider search; revealEmails asks Apollo for their addresses (credits and allowance). Never guesses addresses (prospects:write)', providerAddSchema);
  action('get', '/prospects/settings', 'Prospects', 'Provider status (live, Pending Configuration or Mock Mode) and daily allowances; per-person usage for managers (prospects:read)');
  action('put', '/prospects/settings', 'Prospects', 'Set the daily allowance of provider calls and per-person overrides; audited (prospects:manage)', prospectSettingsSchema);
  action('get', '/prospects/usage', 'Prospects', 'Your provider calls in the last 24 hours and your limit (prospects:read)');
  action('post', '/prospects/search', 'Prospects', 'Search Apollo.io for people by company website, title, country, company size or keywords; Mock Mode returns labelled sample people. 429 USAGE_LIMIT (prospects:search)', providerSearchSchema);
  action('post', '/prospects/move', 'Prospects', 'Move or copy prospects to another list, skipping people already there (prospects:write)', prospectMoveSchema);
  action('post', '/prospects/delete', 'Prospects', 'Delete prospects (prospects:write)', prospectIdsSchema);
  action('post', '/prospects/to-crm', 'Prospects', 'Add prospects as leads (or link existing leads and contacts), optionally enrolling them in a running sequence; sample data is skipped (prospects:write, leads:write; sequences:write to enrol)', prospectToCrmSchema);
  action('post', '/prospects/verify', 'Prospects', 'Verify up to 50 addresses with Hunter.io. 409 PENDING_CONFIGURATION without HUNTER_API_KEY (prospects:search)', prospectIdsSchema);
  action('patch', '/prospects/{id}', 'Prospects', 'Edit a prospect (prospects:write)', prospectUpdateSchema);
  // Part 2 from the browser extension: sign in with a password, discover people at the company on screen, import them.
  r.registerPath({ method: 'post', path: '/extension/login', tags: ['Browser extension'], summary: 'Public: sign in with email and password; returns an extension connection (dfx_ token, no cookie) or a second-factor challenge. SSO-enforced workspaces get 403 SSO_REQUIRED and use a connection code (no auth)', request: body(extensionLoginSchema), responses: { 200: ok('Connection, or { mfaRequired, challenge }'), 401: json(error, 'Wrong email or password'), 403: json(error, 'SSO required') } });
  r.registerPath({ method: 'post', path: '/extension/login/mfa', tags: ['Browser extension'], summary: 'Public: finish an extension sign-in with an authenticator or recovery code (no auth)', request: body(extensionLoginMfaSchema), responses: { 200: ok('Connection'), 401: json(error, 'Invalid code or expired challenge') } });
  action('get', '/extension/prospect-lists', 'Browser extension', 'Prospect lists to import into (prospects:read, extension token)');
  action('get', '/extension/prospects/usage', 'Browser extension', 'Your provider calls in the last 24 hours and your limit (prospects:read, extension token)');
  action('post', '/extension/prospects/discover', 'Browser extension', 'People at the company whose website is open, from Apollo.io; Mock Mode returns labelled sample people (prospects:search, extension token)', extensionDiscoverSchema);
  action('post', '/extension/prospects/import', 'Browser extension', 'Import up to 25 discovered people into a prospect list (existing or new) or the CRM as leads, optionally revealing emails and enrolling; sample people and people without an email never become leads (prospects:write or leads:write, extension token)', extensionProspectImportSchema);

  // Phase 6: billing, custom roles, onboarding, support access and the operator console.
  action('get', '/billing', 'Billing', 'Plan, seats, usage against allowances and what can be bought here (billing:read)');
  action('get', '/billing/invoices', 'Billing', 'Offline invoices and invoices recorded from provider webhooks (billing:read)');
  action('post', '/billing/checkout', 'Billing', 'Start hosted checkout; returns the provider URL. 503 ONLINE_PAYMENTS_OFF unless ONLINE_PAYMENTS_ENABLED (billing:manage)', checkoutSchema);
  r.registerPath({ method: 'post', path: '/billing/invoice-requests', tags: ['Billing'], summary: 'Pay offline: issue an invoice at rate-card prices; one open at a time. The plan starts when an operator records the payment (billing:manage)', security: secured, request: body(invoiceRequestSchema), responses: { 201: ok('Invoice'), ...errors } });
  r.registerPath({ method: 'post', path: '/billing/invoice-requests/{id}/cancel', tags: ['Billing'], summary: 'Withdraw an unpaid offline invoice (billing:manage)', security: secured, request: { params: idParam }, responses: { 204: ok('Canceled'), ...notFound, ...errors } });
  action('post', '/billing/portal', 'Billing', 'Stripe customer portal URL (billing:manage)');
  action('post', '/billing/seats', 'Billing', 'Change seats; Stripe prorates now, Razorpay from the next cycle (billing:manage)', seatsSchema);
  action('post', '/billing/plan', 'Billing', 'Change plan; refuses downgrades current usage does not fit (billing:manage)', changePlanSchema);
  action('post', '/billing/cancel', 'Billing', 'Cancel at the end of the period (billing:manage)');
  action('post', '/billing/resume', 'Billing', 'Withdraw a scheduled cancellation; Stripe only (billing:manage)');
  action('post', '/billing/trial', 'Billing', 'Start the one free trial (billing:manage)', trialSchema);
  for (const provider of ['stripe', 'razorpay']) {
    r.registerPath({ method: 'post', path: `/billing/webhooks/${provider}`, tags: ['Billing'], summary: `Public: ${provider} webhook, verified by signature over the raw body; idempotent per event id`,
      responses: { 200: ok('Received'), 400: json(error, 'Invalid signature'), 404: json(error, 'Provider not configured') } });
  }
  r.registerPath({ method: 'get', path: '/public/pricing', tags: ['Billing'], summary: 'Public: the rate card, labelled a preview until published (no auth)', responses: { 200: ok('Pricing') } });
  r.registerPath({ method: 'post', path: '/tenants/current/roles', tags: ['Tenants'], summary: 'Create a custom role; plan-gated; only permissions you hold (members:manage)', security: secured, request: body(roleInputSchema), responses: { 201: ok('Role'), ...errors } });
  action('put', '/tenants/current/roles/{id}', 'Tenants', 'Update a custom role (members:manage)', roleInputSchema);
  r.registerPath({ method: 'delete', path: '/tenants/current/roles/{id}', tags: ['Tenants'], summary: 'Delete an unused custom role (members:manage)', security: secured, request: { params: idParam }, responses: { 204: ok('Deleted'), ...notFound, ...errors } });
  action('get', '/onboarding', 'Tenants', 'Getting-started checklist derived from workspace data (dashboard:read)');
  r.registerPath({ method: 'post', path: '/onboarding/dismiss', tags: ['Tenants'], summary: 'Hide or show the checklist (tenant:manage)', security: secured, request: body(z.object({ dismissed: z.boolean().optional() })), responses: { 204: ok('Saved'), ...errors } });
  action('get', '/support-access', 'Tenants', 'Support access grants (tenant:manage)');
  r.registerPath({ method: 'post', path: '/support-access', tags: ['Tenants'], summary: 'Let platform support see members and the audit log for 1 to 72 hours (tenant:manage)', security: secured, request: body(supportGrantSchema), responses: { 201: ok('Grant'), ...errors } });
  r.registerPath({ method: 'delete', path: '/support-access/{id}', tags: ['Tenants'], summary: 'End support access now (tenant:manage)', security: secured, request: { params: idParam }, responses: { 204: ok('Ended'), ...notFound, ...errors } });
  const op = (method: 'get' | 'post', path: string, summary: string, schema?: z.ZodTypeAny) =>
    r.registerPath({ method, path: `/operator${path}`, tags: ['Operator'], summary: `Operator console: ${summary}. Separate df_op session; 404 when the console is disabled`,
      request: { ...(path.includes('{id}') ? { params: idParam } : {}), ...(schema ? body(schema) : {}) }, responses: { 200: ok('OK'), 401: json(error, 'No operator session'), 403: json(error, 'Operator role'), 404: json(error, 'Disabled or not found') } });
  op('post', '/login', 'sign in', operatorLoginSchema);
  op('post', '/logout', 'sign out');
  op('get', '/me', 'current operator');
  op('get', '/tenants', 'workspaces with plan and member counts');
  op('get', '/tenants/{id}', 'one workspace; members and audit log only under a support grant');
  op('post', '/tenants/{id}/plan', 'override plan, seats and status (ADMIN)', operatorPlanSchema);
  op('post', '/tenants/{id}/status', 'suspend or reactivate (ADMIN)', operatorStatusSchema);
  op('get', '/invoices/open', 'offline invoices waiting for payment, across workspaces');
  for (const [path, summary, schema] of [
    ['paid', 'record the offline payment of an open invoice; starts or renews the plan it names (ADMIN)', operatorPaymentSchema],
    ['void', 'void an open offline invoice (ADMIN)', operatorVoidSchema],
  ] as const) {
    r.registerPath({ method: 'post', path: `/operator/tenants/{id}/invoices/{invoiceId}/${path}`, tags: ['Operator'], summary: `Operator console: ${summary}`,
      request: { params: z.object({ id: z.string().uuid(), invoiceId: z.string().uuid() }), ...body(schema) }, responses: { 200: ok('Workspace'), 401: json(error, 'No operator session'), 403: json(error, 'Operator role'), 404: json(error, 'Disabled or not found'), 409: json(error, 'Invoice not open') } });
  }
  op('get', '/settings', 'deployment settings: payment instructions on offline invoices and where they come from');
  op('post', '/settings/payment-instructions', 'set the bank details shown on open offline invoices; empty falls back to OFFLINE_PAYMENT_INSTRUCTIONS (ADMIN)', paymentInstructionsSchema);
  op('get', '/providers', 'provider keys this deployment has (set or missing, never values), the last live check and what workspaces show');
  r.registerPath({ method: 'post', path: '/operator/providers/{key}/check', tags: ['Operator'],
    summary: 'Operator console: run a no-cost live check for apollo, hunter or deepgram and store the result; logged (ADMIN, 10 a minute)',
    request: { params: z.object({ key: z.enum(PROVIDER_CHECK_KEYS) }) },
    responses: { 200: ok('Provider row with the new check'), 400: json(error, 'Key not set, or not a checkable provider'), 401: json(error, 'No operator session'), 403: json(error, 'Operator role'), 404: json(error, 'Disabled') } });
  op('get', '/audit-log', 'platform audit log');

  // Phase 7: report builder, dashboards and the data behind the visual explorers.
  action('get', '/reports', 'Reports', 'Saved reports the caller may see: their own and shared ones (reports:read)');
  action('post', '/reports/run', 'Reports', 'Run an unsaved definition; needs read access to its records too (reports:read)', z.object({ definition: reportDefinitionSchema }));
  action('post', '/reports', 'Reports', 'Save a report (reports:write)', reportInputSchema);
  action('get', '/reports/{id}', 'Reports', 'One saved report (reports:read)');
  action('get', '/reports/{id}/result', 'Reports', 'Run a saved report (reports:read)');
  action('get', '/reports/{id}/export', 'Reports', 'CSV of the result; audited (reports:read, data:export)');
  action('put', '/reports/{id}', 'Reports', 'Edit: the author, or reports:manage for shared reports', reportInputSchema);
  action('delete', '/reports/{id}', 'Reports', 'Delete and remove from dashboards (reports:write; reports:manage for others’ shared reports)');
  action('get', '/dashboards', 'Reports', 'Dashboards the caller may see (reports:read)');
  action('post', '/dashboards', 'Reports', 'Create a dashboard of saved reports (reports:write)', dashboardInputSchema);
  action('get', '/dashboards/{id}', 'Reports', 'One dashboard (reports:read)');
  action('put', '/dashboards/{id}', 'Reports', 'Edit name, sharing and widgets (reports:write)', dashboardInputSchema);
  action('delete', '/dashboards/{id}', 'Reports', 'Delete a dashboard; its reports are kept (reports:write)');
  action('get', '/insights/galaxy', 'Reports', 'Companies, contacts and deals as a graph (companies:read; contacts and deals when readable)');
  action('get', '/insights/globe', 'Reports', 'Companies, open pipeline and recent wins by country (companies:read, deals:read)');
  action('get', '/insights/flow', 'Reports', 'Stage-to-stage moves and median time in stage (deals:read, pipelines:read)', undefined, { query: immersiveQuerySchema });
  action('get', '/insights/replay', 'Reports', 'Stage history for a time-based replay (deals:read, pipelines:read)', undefined, { query: immersiveQuerySchema });

  // Enhancement Phase 1: deal health monitor, next best actions, the 360° timeline, record intelligence and insights.
  action('get', '/deal-health', 'Intelligence', 'Open deals with their health score, band and 7-day change (deals:read)', undefined, { query: dealHealthQuerySchema });
  action('get', '/deal-health/summary', 'Intelligence', 'Count of open deals per health band (deals:read)');
  action('post', '/deal-health/refresh', 'Intelligence', 'Score every open deal now instead of waiting for the hourly run (deals:read)');
  action('get', '/deals/{id}/health', 'Intelligence', 'One deal: score, signals behind it, and 90 days of history (deals:read)');
  action('get', '/next-actions', 'Intelligence', 'Ranked next best actions for the caller, or for one record with recordType and recordId (dashboard:read)', undefined, { query: nextActionQuerySchema });
  action('post', '/next-actions/dismiss', 'Intelligence', 'Hide a suggestion, or snooze it for some days; personal to the caller (dashboard:read)', nextActionDismissSchema);
  action('post', '/next-actions/accept', 'Intelligence', 'Turn a suggestion into a task (dashboard:read, activities:write)', nextActionAcceptSchema);
  action('get', '/timeline/{entity}/{id}', 'Intelligence', 'Everything recorded about a lead, contact, company or deal, newest first; sources the caller cannot read are listed in hidden (dashboard:read)', undefined, { query: timelineQuerySchema });
  action('get', '/intelligence/{entity}/{id}', 'Intelligence', 'Engagement trend, buying signals, senior people and account value for one record (dashboard:read)');
  action('get', '/insights', 'Intelligence', 'The last 7 days against the 7 before, for the caller or the team (dashboard:read)', undefined, { query: insightQuerySchema });

  r.registerPath({ method: 'get', path: '/health/live', tags: ['Health'], summary: 'Liveness', responses: { 200: { description: 'OK' } } });
  r.registerPath({ method: 'get', path: '/health/ready', tags: ['Health'], summary: 'Readiness', responses: { 200: { description: 'OK' }, 503: json(error, 'Not ready') } });

  // Phase 8: two-step verification, sessions, workspace security, single sign-on and SCIM.
  r.registerPath({ method: 'post', path: '/auth/mfa/verify', tags: ['Auth'], summary: 'Finish sign-in with an authenticator or recovery code',
    request: { body: { content: { 'application/json': { schema: mfaVerifySchema } } } },
    responses: { 200: json(tenantRef, 'Signed in; auth cookies set'), ...errors } });
  action('get', '/auth/mfa', 'Account security', 'Two-step verification status');
  action('post', '/auth/mfa/setup', 'Account security', 'Start enrolment: returns a new secret and otpauth URI (needs the password)', mfaSetupSchema);
  action('post', '/auth/mfa/enable', 'Account security', 'Confirm enrolment with a code; returns 10 recovery codes once and signs out other devices', mfaEnableSchema);
  action('post', '/auth/mfa/disable', 'Account security', 'Turn off two-step verification (password and code)', mfaDisableSchema);
  action('post', '/auth/mfa/recovery-codes', 'Account security', 'Replace the recovery codes (code required)', mfaRegenerateSchema);
  action('get', '/auth/sessions', 'Account security', 'Signed-in devices for the current user');
  action('post', '/auth/sessions/revoke-others', 'Account security', 'Sign out every other device');
  action('delete', '/auth/sessions/{id}', 'Account security', 'Sign out one device');
  action('get', '/security', 'Workspace security', 'Two-step policy, single sign-on and SCIM settings (tenant:manage)');
  action('put', '/security/mfa-policy', 'Workspace security', 'Require two-step verification for password sign-in (tenant:manage)', mfaPolicySchema);
  action('put', '/security/sso', 'Workspace security', 'Create or update the OIDC connection (tenant:manage)', ssoConnectionSchema);
  action('delete', '/security/sso', 'Workspace security', 'Remove the OIDC connection (tenant:manage)');
  action('post', '/security/scim-tokens', 'Workspace security', 'Create a SCIM token; the token is shown once (tenant:manage)', scimTokenCreateSchema);
  action('delete', '/security/scim-tokens/{id}', 'Workspace security', 'Revoke a SCIM token (tenant:manage)');
  r.registerPath({ method: 'get', path: '/auth/sso/start', tags: ['Single sign-on'], summary: 'Redirect to the workspace identity provider',
    request: { query: z.object({ workspace: z.string().min(1).max(63) }) },
    responses: { 302: { description: 'To the identity provider, or back to /login/sso with sso_error' } } });
  r.registerPath({ method: 'get', path: '/auth/sso/callback', tags: ['Single sign-on'], summary: 'OIDC redirect URI (authorization code with PKCE)',
    request: { query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }) },
    responses: { 302: { description: 'To /app with auth cookies set, or to /login/sso with sso_error' } } });
  r.registerComponent('securitySchemes', 'scimToken', { type: 'http', scheme: 'bearer', description: 'A dfscim_ token from Workspace security' });
  const scim = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, summary: string) =>
    r.registerPath({ method, path: `/scim/v2${path}`, tags: ['SCIM 2.0'], summary, security: [{ scimToken: [] }],
      request: path.includes('{id}') ? { params: idParam } : {},
      responses: { 200: { description: 'SCIM resource (application/scim+json)' }, 401: { description: 'SCIM error' } } });
  scim('get', '/ServiceProviderConfig', 'Supported SCIM features');
  scim('get', '/ResourceTypes', 'Resource types (User)');
  scim('get', '/Users', 'List users (filter: userName, externalId, id or emails eq)');
  scim('post', '/Users', 'Provision a user into the workspace');
  scim('get', '/Users/{id}', 'Get a user');
  scim('put', '/Users/{id}', 'Replace a user');
  scim('patch', '/Users/{id}', 'Update a user (active, name, emails, externalId)');
  scim('delete', '/Users/{id}', 'Remove a user from the workspace');

  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'DealFlow API', version: '1.0.0', description: 'DealFlow by Sampledge, REST API v1.' },
    servers: [{ url: '/api/v1' }],
  });
}
