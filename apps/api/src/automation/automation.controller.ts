import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { approvalDecisionSchema, simulateSchema, TRIGGER_EVENTS, UPDATABLE_FIELDS, type WorkflowInput, workflowInputSchema, z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ApprovalsService } from './approvals.service';
import { WorkflowsService } from './workflows.service';

const uuid = new ParseUUIDPipe();
const statusBody = z.object({ status: z.enum(['ACTIVE', 'PAUSED']) });
const executionQuery = z.object({
  workflowId: z.string().uuid().optional(),
  status: z.enum(['RUNNING', 'WAITING', 'AWAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const approvalQuery = z.object({ status: z.enum(['PENDING', 'DECIDED']).default('PENDING') });

/** Automation Studio. Building, running and approving workflows all need `automation:manage`. */
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('catalog')
  @RequirePermissions('automation:manage')
  catalog() {
    return { triggers: TRIGGER_EVENTS, updatableFields: UPDATABLE_FIELDS };
  }

  @Get()
  @RequirePermissions('automation:manage')
  list(@Auth() auth: AuthContext) {
    return this.workflows.list(auth);
  }

  @Post()
  @RequirePermissions('automation:manage')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(workflowInputSchema)) body: WorkflowInput, @Meta() meta: RequestMeta) {
    return this.workflows.create(auth, body, meta);
  }

  @Post('simulate')
  @HttpCode(200)
  @RequirePermissions('automation:manage')
  simulate(@Auth() auth: AuthContext, @Body(new ZodPipe(simulateSchema)) body: z.infer<typeof simulateSchema>) {
    return this.workflows.simulate(auth, body.definition, body.recordId);
  }

  @Get('executions')
  @RequirePermissions('automation:manage')
  executions(@Auth() auth: AuthContext, @Query(new ZodPipe(executionQuery)) q: z.infer<typeof executionQuery>) {
    return this.workflows.executions(auth, q);
  }

  @Get(':id')
  @RequirePermissions('automation:manage')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.workflows.get(auth, id);
  }

  @Put(':id')
  @RequirePermissions('automation:manage')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(workflowInputSchema)) body: WorkflowInput, @Meta() meta: RequestMeta) {
    return this.workflows.update(auth, id, body, meta);
  }

  @Patch(':id/status')
  @RequirePermissions('automation:manage')
  setStatus(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(statusBody)) body: z.infer<typeof statusBody>, @Meta() meta: RequestMeta) {
    return this.workflows.setStatus(auth, id, body.status, meta);
  }

  @Get(':id/versions')
  @RequirePermissions('automation:manage')
  versions(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.workflows.versions(auth, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('automation:manage')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.workflows.remove(auth, id, meta);
  }
}

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** No route-level permission: each request names the permission needed to see and decide it (automation:manage or quotes:approve). */
  @Get()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(approvalQuery)) q: z.infer<typeof approvalQuery>) {
    return this.approvals.list(auth, q.status);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(
    @Auth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.approvals.decide(auth, id, body.decision, body.note, meta);
  }
}
