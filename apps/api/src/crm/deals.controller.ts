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
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DealsService } from './deals.service';
import { PipelinesService } from './pipelines.service';

const uuid = new ParseUUIDPipe();
const boardQuerySchema = z.object({
  pipelineId: z.string().uuid().optional(),
  perStage: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

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
