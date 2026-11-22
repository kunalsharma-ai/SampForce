import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type BranchInput, branchInputSchema, type CompanyFileRename, companyFileRenameSchema, companyLeadSchema, leadDraftSchema, type OwnerChangeInput, ownerChangeSchema, type z } from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions, AlsoRequireFeature, RequireAction } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { fileFrom, readUpload, sendFile } from '../portal/portal-documents';
import { CompaniesService } from './companies.service';
import { CompanyLeadsService } from './company-leads.service';

const uuid = new ParseUUIDPipe();

/** "+ Create new lead": the lead form, its drafts and the people it offers as owners (ADR 0060). */
@Controller('company-leads')
@ApiKeyAccess()
export class CompanyLeadsController {
  constructor(private readonly leads: CompanyLeadsService) {}

  @Post()
  @RequirePermissions('companies:write', 'contacts:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(companyLeadSchema)) body: z.output<typeof companyLeadSchema>, @Meta() meta: RequestMeta) {
    return this.leads.create(auth, body, meta);
  }

  @Get('people')
  @RequirePermissions('companies:read')
  people(@Auth() auth: AuthContext) {
    return this.leads.people(auth);
  }

  @Get('drafts')
  @AlsoRequireFeature('lead_drafts')
  @RequirePermissions('companies:write')
  drafts(@Auth() auth: AuthContext) {
    return this.leads.drafts(auth);
  }

  @Post('drafts')
  @AlsoRequireFeature('lead_drafts')
  @RequirePermissions('companies:write')
  createDraft(@Auth() auth: AuthContext, @Body(new ZodPipe(leadDraftSchema)) body: z.output<typeof leadDraftSchema>) {
    return this.leads.saveDraft(auth, null, body);
  }

  @Get('drafts/:id')
  @AlsoRequireFeature('lead_drafts')
  @RequirePermissions('companies:write')
  draft(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.leads.draft(auth, id);
  }

  @Put('drafts/:id')
  @AlsoRequireFeature('lead_drafts')
  @RequirePermissions('companies:write')
  saveDraft(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(leadDraftSchema)) body: z.output<typeof leadDraftSchema>) {
    return this.leads.saveDraft(auth, id, body);
  }

  @Delete('drafts/:id')
  @AlsoRequireFeature('lead_drafts')
  @HttpCode(204)
  @RequirePermissions('companies:write')
  removeDraft(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.leads.removeDraft(auth, id);
  }
}

/** Branches, ownership and files of one company lead. */
@Controller('companies/:id')
@ApiKeyAccess()
export class CompanyLeadPartsController {
  constructor(
    private readonly leads: CompanyLeadsService,
    private readonly companies: CompaniesService,
  ) {}

  @Get('branches')
  @AlsoRequireFeature('company_branches')
  @RequirePermissions('companies:read')
  branches(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.leads.branches(auth, id);
  }

  @Post('branches')
  @AlsoRequireFeature('company_branches')
  @RequirePermissions('companies:write')
  addBranch(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(branchInputSchema)) body: BranchInput, @Meta() meta: RequestMeta) {
    return this.leads.saveBranch(auth, id, null, body, meta);
  }

  @Put('branches/:branchId')
  @AlsoRequireFeature('company_branches')
  @RequirePermissions('companies:write')
  saveBranch(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('branchId', uuid) branchId: string, @Body(new ZodPipe(branchInputSchema)) body: BranchInput, @Meta() meta: RequestMeta) {
    return this.leads.saveBranch(auth, id, branchId, body, meta);
  }

  @Delete('branches/:branchId')
  @AlsoRequireFeature('company_branches')
  @HttpCode(204)
  @RequirePermissions('companies:write')
  removeBranch(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('branchId', uuid) branchId: string, @Meta() meta: RequestMeta) {
    return this.leads.removeBranch(auth, id, branchId, meta);
  }

  @Get('owner-history')
  @AlsoRequireFeature('company_owner_changes')
  @RequirePermissions('companies:read')
  ownerHistory(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.leads.ownerHistory(auth, id);
  }

  /** Gives the lead to someone else, with a reason; the new owner is notified and the change is kept in the history. */
  @Post('owner')
  @AlsoRequireFeature('company_owner_changes')
  @RequireAction('assign')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  changeOwner(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(ownerChangeSchema)) body: OwnerChangeInput, @Meta() meta: RequestMeta) {
    return this.companies.update(auth, id, { ownerId: body.ownerId }, meta, { reason: body.reason ?? 'REASSIGNED', note: body.note ?? null });
  }

  @Get('files')
  @AlsoRequireFeature('company_files')
  @RequirePermissions('companies:read')
  files(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.leads.files(auth, id);
  }

  @Post('files')
  @AlsoRequireFeature('company_files')
  @RequirePermissions('companies:write')
  async upload(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('name') name: string | undefined, @Query('rfqId') rfqId: string | undefined, @Req() req: Request, @Meta() meta: RequestMeta) {
    if (rfqId) await uuid.transform(rfqId, { type: 'query' });
    return this.leads.upload(auth, id, fileFrom(req, name, await readUpload(req)), meta, rfqId || undefined);
  }
}

@Controller('company-files')
@AlsoRequireFeature('company_files')
@ApiKeyAccess()
export class CompanyFilesController {
  constructor(private readonly leads: CompanyLeadsService) {}

  @Get(':id/download')
  @RequirePermissions('companies:read')
  async download(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.leads.download(auth, id));
  }

  @Patch(':id')
  @RequirePermissions('companies:write')
  rename(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(companyFileRenameSchema)) body: CompanyFileRename, @Meta() meta: RequestMeta) {
    return this.leads.renameFile(auth, id, body.name, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('companies:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.leads.removeFile(auth, id, meta);
  }
}

@Controller('contacts/:id')
@ApiKeyAccess()
export class EmployeeStatsController {
  constructor(private readonly leads: CompanyLeadsService) {}

  /** The employee's relationship with the team: emails, responses, calls, meetings, follow-ups. */
  @Get('stats')
  @RequirePermissions('contacts:read')
  stats(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.leads.employeeStats(auth, id);
  }
}
