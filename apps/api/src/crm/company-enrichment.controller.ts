import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type EnrichmentUndo, enrichmentUndoSchema } from '@dealflow/types';
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

  /** Undoes what a run filled: every field, or the ones named. */
  @Post('enrichment/:runId/undo')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  undo(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('runId', uuid) runId: string, @Body(new ZodPipe(enrichmentUndoSchema)) body: EnrichmentUndo, @Meta() meta: RequestMeta) {
    return this.enrichment.undo(auth, id, runId, body.fields, meta);
  }
}
