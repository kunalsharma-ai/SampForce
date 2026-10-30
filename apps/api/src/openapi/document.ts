import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import {
  cursorPageQuerySchema,
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
  r.registerPath({ method: 'get', path: '/health/live', tags: ['Health'], summary: 'Liveness', responses: { 200: { description: 'OK' } } });
  r.registerPath({ method: 'get', path: '/health/ready', tags: ['Health'], summary: 'Readiness', responses: { 200: { description: 'OK' }, 503: json(error, 'Not ready') } });

  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'DealFlow API', version: '1.0.0', description: 'DealFlow by Sampledge, REST API v1.' },
    servers: [{ url: '/api/v1' }],
  });
}
