import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  type ActivityInput,
  activityInputSchema,
  CUSTOM_FIELD_ENTITIES,
  type CustomFieldDefInput,
  customFieldDefSchema,
  type ImportRequest,
  importRequestSchema,
  type Permission,
  type TaskInput,
  taskInputSchema,
  taskListQuerySchema,
  taskUpdateSchema,
  z,
} from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ActivitiesService } from './activities.service';
import { CustomFieldsService } from './custom-fields.service';
import { EXPORT_ENTITIES, type ExportEntity, IMPORT_FIELDS, ImportExportService } from './import-export.service';
import { SearchService } from './search.service';
import { TasksService } from './tasks.service';

const uuid = new ParseUUIDPipe();
const activityQuerySchema = z.object({
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
const SEARCH_PERMISSION: Record<'lead' | 'contact' | 'company' | 'deal', Permission> = {
  lead: 'leads:read',
  contact: 'contacts:read',
  company: 'companies:read',
  deal: 'deals:read',
};
const searchQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const ENTITY_PERMISSION: Record<ExportEntity, { read: Permission; write: Permission }> = {
  leads: { read: 'leads:read', write: 'leads:write' },
  contacts: { read: 'contacts:read', write: 'contacts:write' },
  companies: { read: 'companies:read', write: 'companies:write' },
  deals: { read: 'deals:read', write: 'deals:write' },
};

function requirePermission(auth: AuthContext, permission: Permission) {
  if (!auth.permissions.includes(permission)) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do that.', details: [{ path: 'permission', message: permission }] });
  }
}

@Controller('activities')
@ApiKeyAccess()
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions('activities:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(activityQuerySchema)) q: z.infer<typeof activityQuerySchema>) {
    return this.activities.list(auth, q);
  }

  @Post()
  @RequirePermissions('activities:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(activityInputSchema)) body: ActivityInput, @Meta() meta: RequestMeta) {
    return this.activities.create(auth, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.activities.remove(auth, id, meta);
  }
}

@Controller('tasks')
@ApiKeyAccess()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions('activities:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(taskListQuerySchema)) q: z.infer<typeof taskListQuerySchema>) {
    return this.tasks.list(auth, q);
  }

  @Post()
  @RequirePermissions('activities:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(taskInputSchema)) body: TaskInput, @Meta() meta: RequestMeta) {
    return this.tasks.create(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermissions('activities:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(taskUpdateSchema)) body: z.infer<typeof taskUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.tasks.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.tasks.remove(auth, id, meta);
  }
}

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** Searches only the record types the caller may read. */
  @Get()
  search(@Auth() auth: AuthContext, @Query(new ZodPipe(searchQuerySchema)) q: z.infer<typeof searchQuerySchema>) {
    const entities = (Object.keys(SEARCH_PERMISSION) as (keyof typeof SEARCH_PERMISSION)[]).filter((e) =>
      auth.permissions.includes(SEARCH_PERMISSION[e]),
    );
    return this.searchService.search(auth, q.q, entities, q.limit);
  }
}

@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get()
  @RequirePermissions('tenant:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(z.object({ entity: z.enum(CUSTOM_FIELD_ENTITIES).optional() }))) q: { entity?: (typeof CUSTOM_FIELD_ENTITIES)[number] }) {
    return this.fields.list(auth, q.entity);
  }

  @Post()
  @RequirePermissions('tenant:manage')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(customFieldDefSchema)) body: CustomFieldDefInput, @Meta() meta: RequestMeta) {
    return this.fields.create(auth, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('tenant:manage')
  archive(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.fields.archive(auth, id, meta);
  }
}

@Controller()
export class ImportExportController {
  constructor(private readonly io: ImportExportService) {}

  @Get('imports/fields')
  fields() {
    return IMPORT_FIELDS;
  }

  @Post('imports')
  @HttpCode(200)
  run(@Auth() auth: AuthContext, @Body(new ZodPipe(importRequestSchema)) body: ImportRequest, @Meta() meta: RequestMeta) {
    requirePermission(auth, ENTITY_PERMISSION[body.entity].write);
    return this.io.import(auth, body, meta);
  }

  /** Exports are bulk data egress: they need data:export on top of read access, and are audited. */
  @Get('exports/:entity')
  @RequirePermissions('data:export')
  async export(
    @Auth() auth: AuthContext,
    @Param('entity', new ZodPipe(z.enum(EXPORT_ENTITIES))) entity: ExportEntity,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    requirePermission(auth, ENTITY_PERMISSION[entity].read);
    const { csv, rows } = await this.io.export(auth, entity, meta);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="dealflow-${entity}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('x-row-count', String(rows));
    res.setHeader('cache-control', 'no-store');
    return csv;
  }
}
