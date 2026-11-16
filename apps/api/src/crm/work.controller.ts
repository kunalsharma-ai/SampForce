import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  type ActivityInput,
  activityInputSchema,
  CUSTOM_FIELD_ENTITIES,
  EXPORT_FORMATS,
  type CustomFieldDefInput,
  customFieldDefSchema,
  customFieldReorderSchema,
  type CustomFieldUpdate,
  customFieldUpdateSchema,
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
import { fileFrom, readUpload, sendFile } from '../portal/portal-documents';
import { ActivitiesService } from './activities.service';
import { CustomFieldsService } from './custom-fields.service';
import { EXPORT_ENTITIES, type ExportEntity, IMPORT_FIELDS, ImportExportService } from './import-export.service';
import { SearchService } from './search.service';
import { TasksService } from './tasks.service';

const uuid = new ParseUUIDPipe();
const customFieldListQuery = z.object({ entity: z.enum(CUSTOM_FIELD_ENTITIES).optional(), includeInactive: z.enum(['true', 'false']).optional() });
const fileUploadQuery = z.object({ entity: z.enum(CUSTOM_FIELD_ENTITIES), key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), name: z.string().trim().min(1).max(200) });
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
  rfqs: { read: 'companies:read', write: 'companies:write' },
};
const exportQuery = z.object({ format: z.enum(EXPORT_FORMATS).default('csv') });

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

  /** The fields the caller may see; administrators can ask for switched-off fields too. */
  @Get()
  @RequirePermissions('tenant:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(customFieldListQuery)) q: z.infer<typeof customFieldListQuery>) {
    return this.fields.list(auth, q.entity, q.includeInactive === 'true');
  }

  @Post()
  @RequirePermissions('crm:configure')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(customFieldDefSchema)) body: CustomFieldDefInput, @Meta() meta: RequestMeta) {
    return this.fields.create(auth, body, meta);
  }

  @Put('order')
  @RequirePermissions('crm:configure')
  reorder(@Auth() auth: AuthContext, @Body(new ZodPipe(customFieldReorderSchema)) body: z.infer<typeof customFieldReorderSchema>, @Meta() meta: RequestMeta) {
    return this.fields.reorder(auth, body.entity, body.ids, meta);
  }

  /** Uploads a file for a FILE field (raw body, name in the query). The record's save attaches it. */
  @Post('files')
  @RequirePermissions('tenant:read')
  async upload(@Auth() auth: AuthContext, @Query(new ZodPipe(fileUploadQuery)) q: z.infer<typeof fileUploadQuery>, @Req() req: Request) {
    return this.fields.upload(auth, q.entity, q.key, fileFrom(req, q.name, await readUpload(req)));
  }

  @Get('files/:id')
  @RequirePermissions('tenant:read')
  async download(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.fields.download(auth, id));
  }

  @Patch(':id')
  @RequirePermissions('crm:configure')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(customFieldUpdateSchema)) body: CustomFieldUpdate, @Meta() meta: RequestMeta) {
    return this.fields.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('crm:configure')
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
    @Query(new ZodPipe(exportQuery)) q: z.infer<typeof exportQuery>,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string | Buffer> {
    requirePermission(auth, ENTITY_PERMISSION[entity].read);
    const { data, rows, contentType, extension } = await this.io.export(auth, entity, meta, q.format);
    res.setHeader('content-type', contentType);
    res.setHeader('content-disposition', `attachment; filename="sampforce-${entity}-${new Date().toISOString().slice(0, 10)}.${extension}"`);
    res.setHeader('x-row-count', String(rows));
    res.setHeader('cache-control', 'no-store');
    return data;
  }
}
