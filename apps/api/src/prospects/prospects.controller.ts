import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  MAX_PROSPECT_IMPORT_BYTES,
  type ProspectListInput,
  prospectAddSchema,
  prospectIdsSchema,
  prospectImportCommitSchema,
  prospectListInputSchema,
  prospectMoveSchema,
  type ProspectQuery,
  prospectQuerySchema,
  prospectSettingsSchema,
  prospectToCrmSchema,
  prospectUpdateSchema,
  extensionDiscoverSchema,
  extensionProspectImportSchema,
  providerAddSchema,
  type ProviderSearchInput,
  providerSearchSchema,
  z,
} from '@dealflow/types';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Auth, type AuthContext, ExtensionAccess, Meta, type RequestMeta, RequirePermissions, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ProspectsService } from './prospects.service';

const uuid = new ParseUUIDPipe();

async function readFile(req: Request, name: string | undefined): Promise<{ name: string; data: Buffer }> {
  if (!name) throw new BadRequestException({ code: 'INVALID_NAME', message: 'Give the file a name.' });
  const declared = Number(req.headers['content-length']);
  const tooBig = () => new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Files can be up to 5 MB.' });
  if (Number.isFinite(declared) && declared > MAX_PROSPECT_IMPORT_BYTES) throw tooBig();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_PROSPECT_IMPORT_BYTES) throw tooBig();
    chunks.push(chunk);
  }
  return { name: String(name).trim(), data: Buffer.concat(chunks) };
}

@Controller('prospect-lists')
@RequireFeature('prospect_lists')
export class ProspectListsController {
  constructor(private readonly prospects: ProspectsService) {}

  @Get()
  @RequirePermissions('prospects:read')
  lists(@Auth() auth: AuthContext) {
    return this.prospects.lists(auth);
  }

  @Post()
  @RequirePermissions('prospects:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(prospectListInputSchema)) body: ProspectListInput, @Meta() meta: RequestMeta) {
    return this.prospects.createList(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('prospects:read')
  detail(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query(new ZodPipe(prospectQuerySchema)) q: ProspectQuery) {
    return this.prospects.detail(auth, id, q);
  }

  @Put(':id')
  @RequirePermissions('prospects:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(prospectListInputSchema)) body: ProspectListInput, @Meta() meta: RequestMeta) {
    return this.prospects.updateList(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('prospects:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.prospects.deleteList(auth, id, meta);
  }

  @Post(':id/prospects')
  @RequirePermissions('prospects:write')
  add(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(prospectAddSchema)) body: z.infer<typeof prospectAddSchema>, @Meta() meta: RequestMeta) {
    return this.prospects.add(auth, id, body.prospects, meta);
  }

  /** Upload a .csv or .xlsx file as the raw request body (?name=file.xlsx). Returns columns to map. */
  @Post(':id/import')
  @RequirePermissions('prospects:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async importPreview(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('name') name: string | undefined, @Req() req: Request) {
    return this.prospects.importPreview(auth, id, await readFile(req, name));
  }

  @Post(':id/import/:importId')
  @HttpCode(200)
  @RequirePermissions('prospects:write')
  importCommit(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('importId', uuid) importId: string, @Body(new ZodPipe(prospectImportCommitSchema)) body: z.infer<typeof prospectImportCommitSchema>, @Meta() meta: RequestMeta) {
    return this.prospects.importCommit(auth, id, importId, body.mapping, meta);
  }

  @Post(':id/dedupe')
  @HttpCode(200)
  @RequirePermissions('prospects:write')
  dedupe(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.prospects.dedupe(auth, id, meta);
  }

  @Get(':id/performance')
  @RequirePermissions('prospects:read')
  performance(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.prospects.performance(auth, id);
  }

  @Get(':id/export')
  @RequirePermissions('prospects:export')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async export(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const { csv, name, rows, excluded } = await this.prospects.exportCsv(auth, id, meta);
    const file = name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'prospects';
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${file}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('x-row-count', String(rows));
    res.setHeader('x-excluded-count', String(excluded));
    res.setHeader('cache-control', 'no-store');
    return csv;
  }

  /** Adds people from a provider search, optionally revealing their email addresses (uses the allowance). */
  @Post(':id/provider')
  @HttpCode(200)
  @RequirePermissions('prospects:write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async addFromProvider(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(providerAddSchema)) body: z.infer<typeof providerAddSchema>, @Meta() meta: RequestMeta) {
    const { people: _people, outcomes: _outcomes, ...result } = await this.prospects.addFromProvider(auth, id, body, meta);
    return result;
  }
}

@Controller('prospects')
@RequireFeature('prospect_lists')
export class ProspectsController {
  constructor(private readonly prospects: ProspectsService) {}

  @Get('settings')
  @RequirePermissions('prospects:read')
  settings(@Auth() auth: AuthContext) {
    return this.prospects.settings(auth);
  }

  @Put('settings')
  @RequirePermissions('prospects:manage')
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(prospectSettingsSchema)) body: z.infer<typeof prospectSettingsSchema>, @Meta() meta: RequestMeta) {
    return this.prospects.saveSettings(auth, body, meta);
  }

  @Get('usage')
  @RequirePermissions('prospects:read')
  usage(@Auth() auth: AuthContext) {
    return this.prospects.usage(auth);
  }

  @Post('search')
  @HttpCode(200)
  @RequirePermissions('prospects:search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  search(@Auth() auth: AuthContext, @Body(new ZodPipe(providerSearchSchema)) body: ProviderSearchInput) {
    return this.prospects.search(auth, body);
  }

  @Post('move')
  @HttpCode(200)
  @RequirePermissions('prospects:write')
  move(@Auth() auth: AuthContext, @Body(new ZodPipe(prospectMoveSchema)) body: z.infer<typeof prospectMoveSchema>, @Meta() meta: RequestMeta) {
    return this.prospects.move(auth, body, meta);
  }

  @Post('delete')
  @HttpCode(200)
  @RequirePermissions('prospects:write')
  remove(@Auth() auth: AuthContext, @Body(new ZodPipe(prospectIdsSchema)) body: z.infer<typeof prospectIdsSchema>, @Meta() meta: RequestMeta) {
    return this.prospects.remove(auth, body.prospectIds, meta);
  }

  @Post('to-crm')
  @HttpCode(200)
  @RequirePermissions('prospects:write')
  toCrm(@Auth() auth: AuthContext, @Body(new ZodPipe(prospectToCrmSchema)) body: z.infer<typeof prospectToCrmSchema>, @Meta() meta: RequestMeta) {
    return this.prospects.toCrm(auth, body, meta);
  }

  @Post('verify')
  @HttpCode(200)
  @RequirePermissions('prospects:search')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Auth() auth: AuthContext, @Body(new ZodPipe(prospectIdsSchema)) body: z.infer<typeof prospectIdsSchema>) {
    return this.prospects.verify(auth, body.prospectIds);
  }

  @Patch(':id')
  @RequirePermissions('prospects:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(prospectUpdateSchema)) body: z.infer<typeof prospectUpdateSchema>) {
    return this.prospects.update(auth, id, body);
  }
}

/** What the browser extension may do with prospects: its own token reaches only these routes. */
@Controller('extension')
@RequireFeature('prospect_lists')
@ExtensionAccess()
export class ExtensionProspectsController {
  constructor(private readonly prospects: ProspectsService) {}

  @Get('prospect-lists')
  @RequirePermissions('prospects:read')
  lists(@Auth() auth: AuthContext) {
    return this.prospects.lists(auth);
  }

  @Get('prospects/usage')
  @RequirePermissions('prospects:read')
  usage(@Auth() auth: AuthContext) {
    return this.prospects.usage(auth);
  }

  @Post('prospects/discover')
  @HttpCode(200)
  @RequirePermissions('prospects:search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  discover(@Auth() auth: AuthContext, @Body(new ZodPipe(extensionDiscoverSchema)) body: z.infer<typeof extensionDiscoverSchema>) {
    return this.prospects.discover(auth, body);
  }

  @Post('prospects/import')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  import(@Auth() auth: AuthContext, @Body(new ZodPipe(extensionProspectImportSchema)) body: z.infer<typeof extensionProspectImportSchema>, @Meta() meta: RequestMeta) {
    return this.prospects.extensionImport(auth, body, meta);
  }
}
