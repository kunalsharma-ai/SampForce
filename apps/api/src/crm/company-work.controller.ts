import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  followUpCompleteSchema,
  followUpInputSchema,
  followUpListQuerySchema,
  followUpRescheduleSchema,
  followUpUpdateSchema,
  interactionInputSchema,
  interactionUpdateSchema,
  interactionListQuerySchema,
  rfqConvertSchema,
  rfqInputSchema,
  rfqListQuerySchema,
  rfqReportQuerySchema,
  rfqUpdateSchema,
  type z,
  deleteAllSchema,
  deleteAllCountSchema,
  type DeleteAllInput,
} from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequireFeature, RequirePermissions, AlsoRequireFeature, RequireAction } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { CompanyWorkService } from './company-work.service';
import { ConfirmPassword } from '../common/password-confirmation';

const uuid = new ParseUUIDPipe();

/** The company dashboard: key numbers, the employee directory and the interactions log (ADR 0060, Phase 3). */
@Controller('companies/:id')
@ApiKeyAccess()
export class CompanyDashboardController {
  constructor(private readonly work: CompanyWorkService) {}

  @Get('dashboard')
  @RequirePermissions('companies:read')
  dashboard(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.work.dashboard(auth, id);
  }

  @Get('employees')
  @RequirePermissions('companies:read', 'contacts:read')
  employees(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.work.employees(auth, id);
  }

  @Get('interactions')
  @AlsoRequireFeature('interactions')
  @RequirePermissions('companies:read', 'activities:read')
  interactions(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query(new ZodPipe(interactionListQuerySchema)) q: z.output<typeof interactionListQuerySchema>) {
    return this.work.interactions(auth, id, q);
  }
}

@Controller('interactions')
@AlsoRequireFeature('interactions')
@ApiKeyAccess()
export class InteractionsController {
  constructor(private readonly work: CompanyWorkService) {}

  @Post()
  @RequirePermissions('activities:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(interactionInputSchema)) body: z.output<typeof interactionInputSchema>, @Meta() meta: RequestMeta) {
    return this.work.logInteraction(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermissions('activities:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(interactionUpdateSchema)) body: z.output<typeof interactionUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.work.updateInteraction(auth, id, body, meta);
  }

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.work.removeInteraction(auth, id, meta);
  }
}

@Controller('follow-ups')
@AlsoRequireFeature('follow_up_management')
@ApiKeyAccess()
export class FollowUpsController {
  constructor(private readonly work: CompanyWorkService) {}

  /** Delete every record this list shows for its filters, on every page, with no limit (ADR 0096). */
  @ConfirmPassword()
  @Post('delete-all')
  @HttpCode(200)
  @RequireAction('delete')
  @RequirePermissions('activities:write')
  deleteAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllSchema)) body: DeleteAllInput, @Meta() meta: RequestMeta) {
    return this.work.deleteAllFollowUps(auth, body, meta);
  }

  /** How many records "delete all" would delete for this list query, shown before the person confirms. */
  @Post('delete-all/count')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  async countAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllCountSchema)) body: { query: Record<string, string> }) {
    return { count: (await this.work.matchingIdsFollowUps(auth, body.query)).length };
  }


  @Get()
  @RequirePermissions('activities:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(followUpListQuerySchema)) q: z.output<typeof followUpListQuerySchema>) {
    return this.work.followUps(auth, q);
  }

  @Get('counts')
  @RequirePermissions('activities:read')
  counts(@Auth() auth: AuthContext, @Query(new ZodPipe(followUpListQuerySchema)) q: z.output<typeof followUpListQuerySchema>) {
    return this.work.followUpCounts(auth, q);
  }

  @Post()
  @RequirePermissions('activities:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(followUpInputSchema)) body: z.output<typeof followUpInputSchema>, @Meta() meta: RequestMeta) {
    return this.work.createFollowUp(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermissions('activities:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(followUpUpdateSchema)) body: z.output<typeof followUpUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.work.updateFollowUp(auth, id, body, meta);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  complete(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(followUpCompleteSchema)) body: z.output<typeof followUpCompleteSchema>, @Meta() meta: RequestMeta) {
    return this.work.completeFollowUp(auth, id, body.outcome, meta);
  }

  @Post(':id/reschedule')
  @AlsoRequireFeature('follow_up_rescheduling')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  reschedule(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(followUpRescheduleSchema)) body: z.output<typeof followUpRescheduleSchema>, @Meta() meta: RequestMeta) {
    return this.work.rescheduleFollowUp(auth, id, body.dueAt, body.reason, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  cancel(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.work.cancelFollowUp(auth, id, meta);
  }
}

/** Requests for quotation. A plan feature: operators can leave it out of a plan or withhold it from one workspace. */
@Controller('rfqs')
@ApiKeyAccess()
@RequireFeature('rfqs')
export class RfqsController {
  constructor(private readonly work: CompanyWorkService) {}

  /** Delete every record this list shows for its filters, on every page, with no limit (ADR 0096). */
  @ConfirmPassword()
  @Post('delete-all')
  @HttpCode(200)
  @RequireAction('delete')
  @RequirePermissions('companies:write')
  deleteAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllSchema)) body: DeleteAllInput, @Meta() meta: RequestMeta) {
    return this.work.deleteAllRfqs(auth, body, meta);
  }

  /** How many records "delete all" would delete for this list query, shown before the person confirms. */
  @Post('delete-all/count')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  async countAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllCountSchema)) body: { query: Record<string, string> }) {
    return { count: (await this.work.matchingIdsRfqs(auth, body.query)).length };
  }


  @Get()
  @RequirePermissions('companies:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(rfqListQuerySchema)) q: z.output<typeof rfqListQuerySchema>) {
    return this.work.listRfqs(auth, q);
  }

  @Get('report')
  @RequirePermissions('companies:read')
  report(@Auth() auth: AuthContext, @Query(new ZodPipe(rfqReportQuerySchema)) q: z.output<typeof rfqReportQuerySchema>) {
    return this.work.rfqReport(auth, q.by);
  }

  @Get(':id')
  @RequirePermissions('companies:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.work.getRfq(auth, id);
  }

  @Post()
  @RequirePermissions('companies:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(rfqInputSchema)) body: z.output<typeof rfqInputSchema>, @Meta() meta: RequestMeta) {
    return this.work.createRfq(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermissions('companies:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(rfqUpdateSchema)) body: z.output<typeof rfqUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.work.updateRfq(auth, id, body, meta);
  }

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('companies:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.work.removeRfq(auth, id, meta);
  }

  @Post(':id/convert')
  @HttpCode(200)
  @RequirePermissions('companies:write', 'deals:write')
  convert(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(rfqConvertSchema)) body: z.output<typeof rfqConvertSchema>, @Meta() meta: RequestMeta) {
    return this.work.convertRfq(auth, id, body, meta);
  }
}
