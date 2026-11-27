import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type AssignedTaskCreateInput,
  assignedTaskCreateSchema,
  type AssignedTaskUpdateInput,
  assignedTaskUpdateSchema,
  type TargetCreateInput,
  targetCreateSchema,
  type TargetDistributeInput,
  targetDistributeSchema,
  type TargetUpdateInput,
  targetUpdateSchema,
  type TaskCommentInput,
  taskCommentSchema,
  type TaskProgressInput,
  taskProgressSchema,
  type TaskReactionInput,
  taskReactionSchema,
  type WorkspaceDashboardQuery,
  workspaceDashboardQuerySchema,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, OwnHierarchyRules, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AssignedTasksService } from './assigned-tasks.service';
import { WorkspaceDashboardService } from './dashboard.service';
import { TargetsService } from './targets.service';
import { ConfirmPassword } from '../common/password-confirmation';

/**
 * Targets and tasks handed down the workspace hierarchy (ADR 0071, part 4). Who may hand what to whom depends on the
 * caller's workspace, so the services check the rules themselves and refuse with specific codes.
 */
@Controller('targets')
export class TargetsController {
  constructor(private readonly targets: TargetsService) {}

  @Get()
  @RequireFeature('sales_target_management')
  @OwnHierarchyRules()
  list(@Auth() auth: AuthContext) {
    return this.targets.list(auth);
  }

  @Post()
  @RequireFeature('sales_target_management')
  @OwnHierarchyRules()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(targetCreateSchema)) body: TargetCreateInput, @Meta() meta: RequestMeta) {
    return this.targets.create(auth, body, meta);
  }

  @Patch(':id')
  @RequireFeature('sales_target_management')
  @OwnHierarchyRules()
  update(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(targetUpdateSchema)) body: TargetUpdateInput, @Meta() meta: RequestMeta) {
    return this.targets.update(auth, id, body, meta);
  }

  /** Day-by-day progress and earlier periods (ADR 0096). */
  @Get(':id/trend')
  @RequireFeature('sales_target_management')
  @OwnHierarchyRules()
  trend(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.targets.trend(auth, id);
  }

  @Post(':id/distribute')
  @RequireFeature('sales_target_management')
  @OwnHierarchyRules()
  distribute(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(targetDistributeSchema)) body: TargetDistributeInput, @Meta() meta: RequestMeta) {
    return this.targets.distribute(auth, id, body, meta);
  }

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('sales_target_management')
  @OwnHierarchyRules()
  remove(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.targets.remove(auth, id, meta);
  }
}

@Controller('assigned-tasks')
export class AssignedTasksController {
  constructor(private readonly tasks: AssignedTasksService) {}

  @Get()
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  list(@Auth() auth: AuthContext) {
    return this.tasks.list(auth);
  }

  @Get(':id')
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  get(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.tasks.get(auth, id);
  }

  @Post()
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(assignedTaskCreateSchema)) body: AssignedTaskCreateInput, @Meta() meta: RequestMeta) {
    return this.tasks.create(auth, body, meta);
  }

  @Patch(':id')
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  update(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(assignedTaskUpdateSchema)) body: AssignedTaskUpdateInput, @Meta() meta: RequestMeta) {
    return this.tasks.update(auth, id, body, meta);
  }

  @Post(':id/comments')
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  comment(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(taskCommentSchema)) body: TaskCommentInput, @Meta() meta: RequestMeta) {
    return this.tasks.comment(auth, id, body, meta);
  }

  @Post(':id/progress')
  @HttpCode(200)
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  progress(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(taskProgressSchema)) body: TaskProgressInput, @Meta() meta: RequestMeta) {
    return this.tasks.progress(auth, id, body, meta);
  }

  @Post(':id/comments/:commentId/reactions')
  @HttpCode(200)
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  react(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Param('commentId', new ParseUUIDPipe()) commentId: string, @Body(new ZodPipe(taskReactionSchema)) body: TaskReactionInput) {
    return this.tasks.react(auth, id, commentId, body);
  }
}

/** The dashboard of the caller's workspace level (ADR 0071, part 6). */
@Controller('workspace-dashboard')
export class WorkspaceDashboardController {
  constructor(private readonly dashboards: WorkspaceDashboardService) {}

  @Get()
  @RequirePermissions('dashboard:read')
  @OwnHierarchyRules()
  get(@Auth() auth: AuthContext, @Query(new ZodPipe(workspaceDashboardQuerySchema)) q: WorkspaceDashboardQuery) {
    return this.dashboards.dashboard(auth, q.period ?? 'MONTH');
  }
}
