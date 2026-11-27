import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  type TaskPlanCancelInput,
  taskPlanCancelSchema,
  type TaskPlanCreateInput,
  taskPlanCreateSchema,
  type TaskPlanUpdateInput,
  taskPlanUpdateSchema,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, OwnHierarchyRules, type RequestMeta, RequireFeature } from '../common/auth-context';
import { ConfirmPassword } from '../common/password-confirmation';
import { ZodPipe } from '../common/zod.pipe';
import { TaskPlansService } from './task-plans.service';

/** Recurring tasks counted from real work (ADR 0096). Who may give whom a task is checked in the service. */
@Controller('task-plans')
export class TaskPlansController {
  constructor(private readonly plans: TaskPlansService) {}

  @Get()
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  view(@Auth() auth: AuthContext) {
    return this.plans.view(auth);
  }

  @Get(':id')
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  detail(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.plans.detail(auth, id);
  }

  @Post()
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(taskPlanCreateSchema)) body: TaskPlanCreateInput, @Meta() meta: RequestMeta) {
    return this.plans.create(auth, body, meta);
  }

  @Patch(':id')
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  update(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(taskPlanUpdateSchema)) body: TaskPlanUpdateInput, @Meta() meta: RequestMeta) {
    return this.plans.update(auth, id, body, meta);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  pause(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.plans.setStatus(auth, id, 'PAUSED', {}, meta);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  resume(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.plans.setStatus(auth, id, 'ACTIVE', {}, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  cancel(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(taskPlanCancelSchema)) body: TaskPlanCancelInput, @Meta() meta: RequestMeta) {
    return this.plans.setStatus(auth, id, 'CANCELLED', body, meta);
  }

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('task_management')
  @OwnHierarchyRules()
  remove(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.plans.remove(auth, id, meta);
  }
}
