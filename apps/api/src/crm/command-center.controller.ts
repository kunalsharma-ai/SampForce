import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  creditSplitSchema,
  leadTransferDecisionSchema,
  leadTransferInputSchema,
  leadTransferListSchema,
  revenueRecordUpdateSchema,
  z,
} from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
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

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  cancel(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.transfers.cancel(auth, id, meta);
  }
}
