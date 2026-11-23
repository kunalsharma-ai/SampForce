import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  type AssignWorkspaceMemberInput,
  assignWorkspaceMemberSchema,
  type CreateWorkspaceInput,
  createWorkspaceSchema,
  type MoveWorkspaceInput,
  moveWorkspaceSchema,
  type UpdateWorkspaceInput,
  updateWorkspaceSchema,
  type WorkspacePermissionsInput,
  workspacePermissionsSchema,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, OwnHierarchyRules, type RequestMeta, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { WorkspacesService } from './workspaces.service';
import { ConfirmPassword } from '../common/password-confirmation';

/**
 * The organisation's workspace hierarchy (ADR 0071). Who may do what depends on the caller's workspace level, so the
 * service checks the rules itself (OwnHierarchyRules) and refuses with specific codes.
 */
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  /** The caller's workspace, designation, organisation and reporting manager, for the header and profile. */
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.workspaces.identity(auth);
  }

  @Get()
  @RequireFeature('workspace_management')
  @OwnHierarchyRules()
  tree(@Auth() auth: AuthContext) {
    return this.workspaces.tree(auth);
  }

  @Post()
  @RequireFeature('workspace_management')
  @OwnHierarchyRules()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(createWorkspaceSchema)) body: CreateWorkspaceInput, @Meta() meta: RequestMeta) {
    return this.workspaces.create(auth, body, meta);
  }

  @Patch(':id')
  @RequireFeature('workspace_management')
  @OwnHierarchyRules()
  update(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput, @Meta() meta: RequestMeta) {
    return this.workspaces.update(auth, id, body, meta);
  }

  @Put(':id/permissions')
  @RequireFeature('permission_management')
  @OwnHierarchyRules()
  permissions(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(workspacePermissionsSchema)) body: WorkspacePermissionsInput, @Meta() meta: RequestMeta) {
    return this.workspaces.setPermissions(auth, id, body, meta);
  }

  @Post(':id/move')
  @RequireFeature('workspace_management')
  @OwnHierarchyRules()
  move(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(moveWorkspaceSchema)) body: MoveWorkspaceInput, @Meta() meta: RequestMeta) {
    return this.workspaces.move(auth, id, body, meta);
  }

  @Post(':id/members')
  @RequireFeature('workspace_management')
  @OwnHierarchyRules()
  assign(@Auth() auth: AuthContext, @Param('id') id: string, @Body(new ZodPipe(assignWorkspaceMemberSchema)) body: AssignWorkspaceMemberInput, @Meta() meta: RequestMeta) {
    return this.workspaces.assignMember(auth, id, body, meta);
  }

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequireFeature('workspace_management')
  @OwnHierarchyRules()
  archive(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.workspaces.archive(auth, id, meta);
  }
}
