import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
  acceptInvitationSchema,
  activityInputSchema,
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

  r.registerPath({ method: 'get', path: '/health/live', tags: ['Health'], summary: 'Liveness', responses: { 200: { description: 'OK' } } });
  r.registerPath({ method: 'get', path: '/health/ready', tags: ['Health'], summary: 'Readiness', responses: { 200: { description: 'OK' }, 503: json(error, 'Not ready') } });

  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'DealFlow API', version: '1.0.0', description: 'DealFlow by Sampledge, REST API v1.' },
    servers: [{ url: '/api/v1' }],
  });
}
