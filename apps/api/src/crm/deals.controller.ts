import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  bulkDealUpdateSchema,
  type DealInput,
  dealInputSchema,
  type DealMoveInput,
  dealMoveSchema,
  dealUpdateSchema,
  type ListQuery,
  listQuerySchema,
  type PipelineInput,
  pipelineInputSchema,
  type TerritoryInput,
  territoryInputSchema,
  territoryUpdateSchema,
  z,
} from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DealsService } from './deals.service';
import { PipelinesService } from './pipelines.service';
import { TerritoriesService } from './territories.service';

const uuid = new ParseUUIDPipe();
const boardQuerySchema = z.object({
  pipelineId: z.string().uuid().optional(),
  perStage: z.coerce.number().int().min(1).max(200).default(50),
});

const viewQuerySchema = z.object({
  pipelineId: z.string().uuid().optional(),
  ownerId: z.union([z.literal('me'), z.string().uuid()]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type ViewQuery = z.infer<typeof viewQuerySchema>;
const owner = (auth: AuthContext, q: ViewQuery) => ({ pipelineId: q.pipelineId, ownerId: q.ownerId === 'me' ? auth.userId : q.ownerId, limit: q.limit });

@Controller('deals')
@ApiKeyAccess()
export class DealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly territories: TerritoriesService,
  ) {}

  @Get()
  @RequirePermissions('deals:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuerySchema)) q: ListQuery) {
    return this.deals.list(auth, q);
  }

  @Get('board')
  @RequirePermissions('deals:read')
  board(@Auth() auth: AuthContext, @Query(new ZodPipe(boardQuerySchema)) q: z.infer<typeof boardQuerySchema>) {
    return this.deals.board(auth, q.pipelineId, q.perStage);
  }

  @Get('priority')
  @RequirePermissions('deals:read')
  priority(@Auth() auth: AuthContext, @Query(new ZodPipe(viewQuerySchema)) q: ViewQuery) {
    return this.deals.priority(auth, owner(auth, q));
  }

  @Get('forecast')
  @RequirePermissions('deals:read')
  forecast(@Auth() auth: AuthContext, @Query(new ZodPipe(viewQuerySchema)) q: ViewQuery) {
    return this.deals.forecast(auth, owner(auth, q));
  }

  /** Open pipeline and this quarter's results per sales territory (ADR 0049). */
  @Get('territories')
  @RequirePermissions('deals:read')
  territoryView(@Auth() auth: AuthContext, @Query(new ZodPipe(viewQuerySchema)) q: ViewQuery) {
    return this.territories.view(auth, owner(auth, q));
  }

  @Post()
  @RequirePermissions('deals:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(dealInputSchema)) body: DealInput, @Meta() meta: RequestMeta) {
    return this.deals.create(auth, body, meta);
  }

  @Post('bulk-update')
  @HttpCode(200)
  @RequirePermissions('deals:write')
  bulk(@Auth() auth: AuthContext, @Body(new ZodPipe(bulkDealUpdateSchema)) body: z.infer<typeof bulkDealUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.deals.bulkUpdate(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('deals:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.deals.get(auth, id);
  }

  @Get(':id/history')
  @RequirePermissions('deals:read')
  history(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.deals.history(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('deals:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(dealUpdateSchema)) body: Partial<DealInput>, @Meta() meta: RequestMeta) {
    return this.deals.update(auth, id, body, meta);
  }

  @Post(':id/move')
  @HttpCode(200)
  @RequirePermissions('deals:write')
  move(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(dealMoveSchema)) body: DealMoveInput, @Meta() meta: RequestMeta) {
    return this.deals.move(auth, id, body, meta);
  }

  @Post(':id/clone')
  @RequirePermissions('deals:write')
  clone(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.deals.clone(auth, id, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('deals:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.deals.remove(auth, id, meta);
  }
}

@Controller('pipelines')
@ApiKeyAccess()
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  @RequirePermissions('pipelines:read')
  list(@Auth() auth: AuthContext) {
    return this.pipelines.list(auth);
  }

  @Post()
  @RequirePermissions('pipelines:manage')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(pipelineInputSchema)) body: PipelineInput, @Meta() meta: RequestMeta) {
    return this.pipelines.create(auth, body, meta);
  }

  @Put(':id')
  @RequirePermissions('pipelines:manage')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(pipelineInputSchema)) body: PipelineInput, @Meta() meta: RequestMeta) {
    return this.pipelines.update(auth, id, body, meta);
  }

  @Post(':id/default')
  @HttpCode(204)
  @RequirePermissions('pipelines:manage')
  setDefault(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.pipelines.setDefault(auth, id, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('pipelines:manage')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.pipelines.remove(auth, id, meta);
  }
}

/** Sales territories: anyone who reads deals sees them; owners and administrators define them. */
@Controller('territories')
@RequireFeature('territories')
@ApiKeyAccess()
export class TerritoriesController {
  constructor(private readonly territories: TerritoriesService) {}

  @Get()
  @RequirePermissions('deals:read')
  list(@Auth() auth: AuthContext) {
    return this.territories.list(auth);
  }

  @Post()
  @RequirePermissions('tenant:manage')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(territoryInputSchema)) body: TerritoryInput, @Meta() meta: RequestMeta) {
    return this.territories.create(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermissions('tenant:manage')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(territoryUpdateSchema)) body: Partial<TerritoryInput>, @Meta() meta: RequestMeta) {
    return this.territories.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('tenant:manage')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.territories.remove(auth, id, meta);
  }
}
