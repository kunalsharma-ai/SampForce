import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { type PutClientMenuSections, putClientMenuSectionsSchema, type PutClientWorkspaceRules, putClientWorkspaceRulesSchema, type PutPlanWorkspaceRules, putPlanWorkspaceRulesSchema, z } from '@dealflow/types';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { Operator, type OperatorContext, OperatorGuard, OperatorPermission } from './operator-auth';
import { WorkspaceRulesService } from './workspace-rules.service';

const ip = (req: Request) => req.ip ?? null;
const planCode = new ZodPipe(z.string().regex(/^[a-z0-9_]{1,60}$/));

/**
 * Console rules for client workspaces (workspace redesign W3). Reading needs workspaces.view; changing them needs workspaces.manage.
 * `@Public()` only skips the workspace guard; OperatorGuard protects every route.
 */
@Controller('operator/workspace-rules')
@Public()
@UseGuards(OperatorGuard)
export class WorkspaceRulesController {
  constructor(private readonly rules: WorkspaceRulesService) {}

  @Get()
  @OperatorPermission('workspaces.view')
  plans() {
    return this.rules.plans();
  }

  @Put('plans/:code')
  @OperatorPermission('workspaces.manage')
  setPlan(@Operator() op: OperatorContext, @Param('code', planCode) code: string, @Body(new ZodPipe(putPlanWorkspaceRulesSchema)) body: PutPlanWorkspaceRules, @Req() req: Request) {
    return this.rules.setPlan(op, code, body, ip(req));
  }

  @Get('clients/:id')
  @OperatorPermission('workspaces.view')
  client(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.rules.client(id);
  }

  @Put('clients/:id')
  @OperatorPermission('workspaces.manage')
  setClient(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(putClientWorkspaceRulesSchema)) body: PutClientWorkspaceRules, @Req() req: Request) {
    return this.rules.setClient(op, id, body, ip(req));
  }

  @Get('clients/:id/menu-sections')
  @OperatorPermission('workspaces.view')
  menuSections(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.rules.menuSections(id);
  }

  @Put('clients/:id/menu-sections')
  @OperatorPermission('workspaces.manage')
  setMenuSections(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(putClientMenuSectionsSchema)) body: PutClientMenuSections, @Req() req: Request) {
    return this.rules.setMenuSections(op, id, body, ip(req));
  }
}
