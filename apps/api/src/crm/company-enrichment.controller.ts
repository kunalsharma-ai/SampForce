import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type EnrichmentPreviewRequest, enrichmentPreviewSchema, type EnrichmentUndo, enrichmentUndoSchema } from '@dealflow/types';
import { AlsoRequireFeature, ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { CompanyEnrichmentService } from './company-enrichment.service';

const uuid = new ParseUUIDPipe();

/** Company auto-fill (ADR 0076): what was filled and from where, look up again, undo. */
@Controller('companies/:id')
@ApiKeyAccess()
@AlsoRequireFeature('company_enrichment')
export class CompanyEnrichmentController {
  constructor(private readonly enrichment: CompanyEnrichmentService) {}

  @Get('enrichment')
  @RequirePermissions('companies:read')
  state(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.enrichment.state(auth, id);
  }

  /** Looks the company up again now (the Enrich button). */
  @Post('enrich')
  @HttpCode(202)
  @RequirePermissions('companies:write')
  enrich(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.enrichment.enrich(auth, id, meta);
  }

  /** People the company publishes, to add as employees (ADR 0079). Nothing is stored. */
  @Post('find-people')
  @HttpCode(200)
  @RequirePermissions('contacts:write')
  findPeople(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.enrichment.findPeople(auth, id);
  }

  /** Undoes what a run filled: every field, or the ones named. */
  @Post('enrichment/:runId/undo')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  undo(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('runId', uuid) runId: string, @Body(new ZodPipe(enrichmentUndoSchema)) body: EnrichmentUndo, @Meta() meta: RequestMeta) {
    return this.enrichment.undo(auth, id, runId, body.fields, meta);
  }
}

/** Looks a company up before it is saved, for the review step of Create Company (ADR 0076). Nothing is stored. */
@Controller('companies')
@ApiKeyAccess()
@AlsoRequireFeature('company_enrichment')
export class CompanyAutofillPreviewController {
  constructor(private readonly enrichment: CompanyEnrichmentService) {}

  @Post('autofill-preview')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  preview(@Auth() auth: AuthContext, @Body(new ZodPipe(enrichmentPreviewSchema)) body: EnrichmentPreviewRequest) {
    return this.enrichment.preview(auth, body);
  }
}
