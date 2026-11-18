import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  clientConcernEscalateSchema,
  clientConcernInputSchema,
  clientConcernListSchema,
  clientConcernResolveSchema,
  clientConcernUpdateSchema,
  creditSplitSchema,
  instructionInputSchema,
  instructionListSchema,
  instructionProgressSchema,
  instructionUpdateSchema,
  leadTransferDecisionSchema,
  leadTransferInputSchema,
  leadTransferListSchema,
  leadTransferUpdateSchema,
  revenueRecordUpdateSchema,
  z,
} from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ClientConcernsService } from './client-concerns.service';
import { InstructionsService } from './instructions.service';
import { LeadTransfersService } from './lead-transfers.service';
import { RevenueRecordsService } from './revenue-records.service';

const uuid = new ParseUUIDPipe();
const revenueListSchema = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), userId: z.string().uuid().optional() });

/** Revenue records of won deals and won RFQs, and their attribution (ADR 0063). */
@Controller('revenue-records')
@ApiKeyAccess()
@RequireFeature('revenue_attribution')
export class RevenueRecordsController {
  constructor(private readonly revenue: RevenueRecordsService) {}

  @Get()
  @RequirePermissions('deals:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(revenueListSchema)) q: z.infer<typeof revenueListSchema>) {
    return this.revenue.list(auth, q);
  }

  /** Splits every record not split by hand again with the workspace's current attribution rule. */
  @Post('recalculate')
  @HttpCode(200)
  @RequirePermissions('pipelines:manage')
  recalculate(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.revenue.recalculate(auth, meta);
  }

  @Get(':id')
  @RequirePermissions('deals:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.revenue.get(auth, id);
  }

  /** Recognised and collected amounts and the payment status. */
  @Patch(':id')
  @RequirePermissions('deals:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(revenueRecordUpdateSchema)) body: z.infer<typeof revenueRecordUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.revenue.update(auth, id, body, meta);
  }

  /** A split entered by hand: shares per person, summing to 100%. */
  @Put(':id/credits')
  @RequirePermissions('pipelines:manage')
  setCredits(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(creditSplitSchema)) body: z.infer<typeof creditSplitSchema>, @Meta() meta: RequestMeta) {
    return this.revenue.setCredits(auth, id, body, meta);
  }

  /** Puts one record back on the workspace rule. */
  @Post(':id/credits/reset')
  @HttpCode(200)
  @RequirePermissions('pipelines:manage')
  resetCredits(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.revenue.recalculate(auth, meta, id);
  }
}

/** Requests to move a lead to a manager or senior person, and their decisions (ADR 0063). */
@Controller('lead-transfers')
@ApiKeyAccess()
@RequireFeature('lead_transfers')
export class LeadTransfersController {
  constructor(private readonly transfers: LeadTransfersService) {}

  @Get()
  @RequirePermissions('companies:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(leadTransferListSchema)) q: z.output<typeof leadTransferListSchema>) {
    return this.transfers.list(auth, q);
  }

  @Post()
  @RequirePermissions('companies:write')
  request(@Auth() auth: AuthContext, @Body(new ZodPipe(leadTransferInputSchema)) body: z.output<typeof leadTransferInputSchema>, @Meta() meta: RequestMeta) {
    return this.transfers.request(auth, body, meta);
  }

  /** Approve, reject or reassign. */
  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  decide(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(leadTransferDecisionSchema)) body: z.output<typeof leadTransferDecisionSchema>, @Meta() meta: RequestMeta) {
    return this.transfers.decide(auth, id, body, meta);
  }

  /** The requester changes a pending request. */
  @Patch(':id')
  @RequirePermissions('companies:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(leadTransferUpdateSchema)) body: z.output<typeof leadTransferUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.transfers.update(auth, id, body, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  cancel(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.transfers.cancel(auth, id, meta);
  }
}

/** Instructions and remarks from managers and senior people to the people below them (ADR 0063). */
@Controller('instructions')
@ApiKeyAccess()
@RequireFeature('instructions')
export class InstructionsController {
  constructor(private readonly instructions: InstructionsService) {}

  @Get()
  @RequirePermissions('dashboard:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(instructionListSchema)) q: z.output<typeof instructionListSchema>) {
    return this.instructions.list(auth, q);
  }

  @Post()
  @RequirePermissions('dashboard:read')
  send(@Auth() auth: AuthContext, @Body(new ZodPipe(instructionInputSchema)) body: z.output<typeof instructionInputSchema>, @Meta() meta: RequestMeta) {
    return this.instructions.send(auth, body, meta);
  }

  /** The recipient acknowledges, completes or reopens it. */
  @Post(':id/progress')
  @HttpCode(200)
  @RequirePermissions('dashboard:read')
  progress(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(instructionProgressSchema)) body: z.output<typeof instructionProgressSchema>, @Meta() meta: RequestMeta) {
    return this.instructions.progress(auth, id, body, meta);
  }

  /** The sender changes an open instruction. */
  @Patch(':id')
  @RequirePermissions('dashboard:read')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(instructionUpdateSchema)) body: z.output<typeof instructionUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.instructions.update(auth, id, body, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('dashboard:read')
  cancel(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.instructions.cancel(auth, id, meta);
  }
}

/** Client concerns and rejections, with their resolution and escalation (ADR 0063). */
@Controller('client-concerns')
@ApiKeyAccess()
@RequireFeature('client_concerns')
export class ClientConcernsController {
  constructor(private readonly concerns: ClientConcernsService) {}

  @Get()
  @RequirePermissions('companies:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(clientConcernListSchema)) q: z.output<typeof clientConcernListSchema>) {
    return this.concerns.list(auth, q);
  }

  @Post()
  @RequirePermissions('companies:write')
  raise(@Auth() auth: AuthContext, @Body(new ZodPipe(clientConcernInputSchema)) body: z.output<typeof clientConcernInputSchema>, @Meta() meta: RequestMeta) {
    return this.concerns.raise(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermissions('companies:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(clientConcernUpdateSchema)) body: z.output<typeof clientConcernUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.concerns.update(auth, id, body, meta);
  }

  @Post(':id/escalate')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  escalate(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(clientConcernEscalateSchema)) body: z.output<typeof clientConcernEscalateSchema>, @Meta() meta: RequestMeta) {
    return this.concerns.escalate(auth, id, body, meta);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  resolve(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(clientConcernResolveSchema)) body: z.output<typeof clientConcernResolveSchema>, @Meta() meta: RequestMeta) {
    return this.concerns.resolve(auth, id, body.resolution, meta);
  }
}
