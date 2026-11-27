import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  type ActivityInput,
  activityInputSchema,
  type ActivityUpdate,
  activityUpdateSchema,
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
  listQuerySchema,
  z,
  deleteAllSchema,
  deleteAllCountSchema,
  type DeleteAllInput,
} from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions, AlsoRequireFeature, RequireAction } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { fileFrom, readUpload, sendFile } from '../portal/portal-documents';
import { activityListQuerySchema, ActivitiesService } from './activities.service';
import { CustomFieldsService } from './custom-fields.service';
import { EXPORT_ENTITIES, type ExportEntity, ImportExportService, xlsxToCsv } from './import-export.service';
import { COMPANY_EXPORT_PARTS, CompanyExportService, type ExportFile } from './company-export.service';
import { companyFiltersSchema } from './records.controller';
import { IMPORT_FIELDS, ImportService } from './import.service';
import { SearchService } from './search.service';
import { TasksService } from './tasks.service';
import { ConfirmPassword } from '../common/password-confirmation';

const uuid = new ParseUUIDPipe();
const customFieldListQuery = z.object({ entity: z.enum(CUSTOM_FIELD_ENTITIES).optional(), includeInactive: z.enum(['true', 'false']).optional() });
const fileUploadQuery = z.object({ entity: z.enum(CUSTOM_FIELD_ENTITIES), key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), name: z.string().trim().min(1).max(200) });
const activityQuerySchema = activityListQuerySchema;
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
/** Company exports (ADR 0079) take the company list's filters, so the file matches the list on screen. */
const companyExportQuery = listQuerySchema
  .pick({ q: true, sort: true, order: true, ownerId: true, status: true, cf: true })
  .merge(companyFiltersSchema)
  .extend({ format: z.enum(EXPORT_FORMATS).default('csv'), part: z.enum(COMPANY_EXPORT_PARTS).optional() });
const singleCompanyExportQuery = z.object({ format: z.enum(EXPORT_FORMATS).default('xlsx'), part: z.enum(COMPANY_EXPORT_PARTS).optional() });

function requirePermission(auth: AuthContext, permission: Permission) {
  if (!auth.permissions.includes(permission)) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do that.', details: [{ path: 'permission', message: permission }] });
  }
}

@Controller('activities')
@ApiKeyAccess()
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  /** Delete every record this list shows for its filters, on every page, with no limit (ADR 0096). */
  @ConfirmPassword()
  @Post('delete-all')
  @HttpCode(200)
  @RequireAction('delete')
  @RequirePermissions('activities:write')
  deleteAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllSchema)) body: DeleteAllInput, @Meta() meta: RequestMeta) {
    return this.activities.deleteAll(auth, body, meta);
  }

  /** How many records "delete all" would delete for this list query, shown before the person confirms. */
  @Post('delete-all/count')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  async countAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllCountSchema)) body: { query: Record<string, string> }) {
    return { count: (await this.activities.matchingIds(auth, body.query)).length };
  }


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

  @Get(':id')
  @RequirePermissions('activities:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.activities.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('activities:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(activityUpdateSchema)) body: ActivityUpdate, @Meta() meta: RequestMeta) {
    return this.activities.update(auth, id, body, meta);
  }

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.activities.remove(auth, id, meta);
  }
}

@Controller('tasks')
@AlsoRequireFeature('task_management')
@ApiKeyAccess()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** Delete every record this list shows for its filters, on every page, with no limit (ADR 0096). */
  @ConfirmPassword()
  @Post('delete-all')
  @HttpCode(200)
  @RequireAction('delete')
  @RequirePermissions('activities:write')
  deleteAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllSchema)) body: DeleteAllInput, @Meta() meta: RequestMeta) {
    return this.tasks.deleteAll(auth, body, meta);
  }

  /** How many records "delete all" would delete for this list query, shown before the person confirms. */
  @Post('delete-all/count')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  async countAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllCountSchema)) body: { query: Record<string, string> }) {
    return { count: (await this.tasks.matchingIds(auth, body.query)).length };
  }


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

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.tasks.remove(auth, id, meta);
  }
}

@Controller('search')
@AlsoRequireFeature('global_search')
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

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('crm:configure')
  archive(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.fields.archive(auth, id, meta);
  }
}

@Controller()
export class ImportExportController {
  constructor(
    private readonly io: ImportExportService,
    private readonly importer: ImportService,
    private readonly companyExport: CompanyExportService,
  ) {}

  @Get('imports/fields')
  @AlsoRequireFeature('data_import')
  fields() {
    return IMPORT_FIELDS;
  }

  @Post('imports')
  @AlsoRequireFeature('data_import')
  @HttpCode(200)
  run(@Auth() auth: AuthContext, @Body(new ZodPipe(importRequestSchema)) body: ImportRequest, @Meta() meta: RequestMeta) {
    // A company-and-employee file writes both kinds of record.
    if (body.entity === 'companies_contacts') {
      requirePermission(auth, 'companies:write');
      requirePermission(auth, 'contacts:write');
    } else requirePermission(auth, ENTITY_PERMISSION[body.entity].write);
    return this.importer.import(auth, body, meta);
  }

  /** An Excel workbook becomes CSV text here, and is then mapped and imported like a CSV file. Nothing is saved. */
  @Post('imports/file')
  @AlsoRequireFeature('data_import')
  @HttpCode(200)
  async readFile(@Auth() auth: AuthContext, @Req() req: Request) {
    if (!(['leads:write', 'contacts:write', 'companies:write'] as const).some((p) => auth.permissions.includes(p))) requirePermission(auth, 'contacts:write');
    const data = await readUpload(req);
    if (data.length > 2_000_000) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This file is larger than 2 MB. Split it into smaller files.', details: [{ path: 'data', message: 'This file is larger than 2 MB. Split it into smaller files.' }] });
    return xlsxToCsv(data);
  }

  /** Exports are bulk data egress: they need data:export on top of read access, and are audited. */
  @Get('exports/:entity')
  @RequireAction('export')
  @RequirePermissions('data:export')
  async export(
    @Auth() auth: AuthContext,
    @Param('entity', new ZodPipe(z.enum(EXPORT_ENTITIES))) entity: ExportEntity,
    @Query(new ZodPipe(exportQuery)) q: z.infer<typeof exportQuery>,
    @Query() query: Record<string, unknown>,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string | StreamableFile> {
    requirePermission(auth, ENTITY_PERMISSION[entity].read);
    if (entity === 'companies') {
      // Every company field, employees, branches and interactions, filtered like the list (ADR 0079).
      const c = new ZodPipe(companyExportQuery).transform(query) as z.output<typeof companyExportQuery>;
      const { format, part, q: search, sort, order, ownerId, status, cf, ...f } = c;
      return send(res, await this.companyExport.export(auth, { format, part, q: { q: search, sort, order, ownerId, status }, f: { ...f, cf } }, meta));
    }
    const { data, rows, contentType, extension } = await this.io.export(auth, entity, meta, q.format);
    return send(res, { data, rows, contentType, extension, filename: `sampforce-${entity}-${new Date().toISOString().slice(0, 10)}.${extension}` });
  }

  /** One company from its page: every field, its employees, branches and interactions (ADR 0079). */
  @Get('companies/:id/export')
  @RequireAction('export')
  @RequirePermissions('data:export', 'companies:read')
  async exportCompany(
    @Auth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(singleCompanyExportQuery)) q: z.infer<typeof singleCompanyExportQuery>,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string | StreamableFile> {
    return send(res, await this.companyExport.export(auth, { format: q.format, part: q.part, companyId: id }, meta));
  }
}

function send(res: Response, file: ExportFile): string | StreamableFile {
  res.setHeader('content-type', file.contentType);
  res.setHeader('content-disposition', `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('x-row-count', String(file.rows));
  res.setHeader('cache-control', 'no-store');
  // A Buffer would be sent as JSON; a StreamableFile is sent as the bytes.
  return typeof file.data === 'string' ? file.data : new StreamableFile(file.data);
}
