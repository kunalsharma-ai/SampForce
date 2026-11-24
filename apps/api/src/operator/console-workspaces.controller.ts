import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  type ConsoleWorkspaceBlacklistInput,
  consoleWorkspaceBlacklistSchema,
  type ConsoleWorkspaceDeleteInput,
  consoleWorkspaceDeleteSchema,
  type ConsoleWorkspaceEditInput,
  consoleWorkspaceEditSchema,
  type ConsoleWorkspaceQuery,
  consoleWorkspaceQuerySchema,
  type ConsoleWorkspaceRestoreInput,
  consoleWorkspaceRestoreSchema,
  type ConsoleWorkspaceSuspendInput,
  consoleWorkspaceSuspendSchema,
  z,
} from '@dealflow/types';
import { Public } from '../common/auth-context';
import { NoPasswordConfirmation } from '../common/password-confirmation';
import { ZodPipe } from '../common/zod.pipe';
import { ConsoleWorkspacesService } from './console-workspaces.service';
import { Operator, type OperatorContext, OperatorGuard, OperatorPermission } from './operator-auth';

const ip = (req: Request) => req.ip ?? null;
/** A workspace id, or `root:<client id>` for a Super Workspace that was never stored. */
const workspaceId = new ZodPipe(z.string().regex(/^(root:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));
const reasonOnly = new ZodPipe(z.object({ reason: z.string().trim().min(3).max(500) }).strict());

/**
 * Console Workspace Management (workspace management, sections 18-22): every client's workspaces, and suspending,
 * blacklisting, deleting and restoring them. Seeing needs workspaces.view, acting workspaces.manage; a Super
 * Workspace's suspension and deletion act on its client, so they also need clients.status (checked in the service).
 * Blocks and deletes carry the operator's password in the body, which the service checks before anything changes.
 */
@Controller('operator/workspaces')
@Public()
@UseGuards(OperatorGuard)
export class ConsoleWorkspacesController {
  constructor(private readonly workspaces: ConsoleWorkspacesService) {}

  @Get()
  @OperatorPermission('workspaces.view')
  list(@Query(new ZodPipe(consoleWorkspaceQuerySchema)) query: ConsoleWorkspaceQuery) {
    return this.workspaces.list(query);
  }

  @Get(':id')
  @OperatorPermission('workspaces.view')
  detail(@Param('id', workspaceId) id: string) {
    return this.workspaces.detail(id);
  }

  @Patch(':id')
  @OperatorPermission('workspaces.manage')
  edit(@Operator() op: OperatorContext, @Param('id', workspaceId) id: string, @Body(new ZodPipe(consoleWorkspaceEditSchema)) body: ConsoleWorkspaceEditInput, @Req() req: Request) {
    return this.workspaces.edit(op, id, body, ip(req));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @OperatorPermission('workspaces.manage')
  suspend(@Operator() op: OperatorContext, @Param('id', workspaceId) id: string, @Body(new ZodPipe(consoleWorkspaceSuspendSchema)) body: ConsoleWorkspaceSuspendInput, @Req() req: Request) {
    return this.workspaces.suspend(op, id, body.reason, body.password, ip(req));
  }

  @Post(':id/blacklist')
  @HttpCode(200)
  @OperatorPermission('workspaces.manage')
  blacklist(@Operator() op: OperatorContext, @Param('id', workspaceId) id: string, @Body(new ZodPipe(consoleWorkspaceBlacklistSchema)) body: ConsoleWorkspaceBlacklistInput, @Req() req: Request) {
    return this.workspaces.blacklist(op, id, body, ip(req));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @OperatorPermission('workspaces.manage')
  reactivate(@Operator() op: OperatorContext, @Param('id', workspaceId) id: string, @Body(reasonOnly) body: { reason: string }, @Req() req: Request) {
    return this.workspaces.reactivate(op, id, body.reason, ip(req));
  }

  @Delete(':id')
  @HttpCode(200)
  @NoPasswordConfirmation('The Console checks the operator password sent in the body (ConsoleWorkspacesService.delete)')
  @OperatorPermission('workspaces.manage')
  remove(@Operator() op: OperatorContext, @Param('id', workspaceId) id: string, @Body(new ZodPipe(consoleWorkspaceDeleteSchema)) body: ConsoleWorkspaceDeleteInput, @Req() req: Request) {
    return this.workspaces.delete(op, id, body, ip(req));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @OperatorPermission('workspaces.manage')
  restore(@Operator() op: OperatorContext, @Param('id', workspaceId) id: string, @Body(new ZodPipe(consoleWorkspaceRestoreSchema)) body: ConsoleWorkspaceRestoreInput, @Req() req: Request) {
    return this.workspaces.restore(op, id, body.reason, ip(req));
  }
}
