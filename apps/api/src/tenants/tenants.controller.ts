import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  type InvitationInput,
  type RoleInput,
  roleInputSchema,
  invitationInputSchema,
  type UpdateMemberRoleInput,
  updateMemberRoleSchema,
  type UpdateTenantInput,
  updateTenantSchema,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { InvitationsService } from './invitations.service';
import { RolesService } from './roles.service';
import { TenantsService } from './tenants.service';

@Controller('tenants/current')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly invitations: InvitationsService,
    private readonly roleService: RolesService,
  ) {}

  @Get()
  @RequirePermissions('tenant:read')
  current(@Auth() auth: AuthContext) {
    return this.tenants.current(auth);
  }

  @Patch()
  @RequirePermissions('tenant:manage')
  update(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(updateTenantSchema)) body: UpdateTenantInput,
    @Meta() meta: RequestMeta,
  ) {
    return this.tenants.update(auth, body, meta);
  }

  @Get('members')
  @RequirePermissions('members:read')
  members(@Auth() auth: AuthContext) {
    return this.tenants.members(auth);
  }

  @Get('roles')
  @RequirePermissions('members:read')
  roles(@Auth() auth: AuthContext) {
    return this.roleService.list(auth);
  }

  @Post('roles')
  @RequirePermissions('members:manage')
  createRole(@Auth() auth: AuthContext, @Body(new ZodPipe(roleInputSchema)) body: RoleInput, @Meta() meta: RequestMeta) {
    return this.roleService.create(auth, body, meta);
  }

  @Put('roles/:id')
  @RequirePermissions('members:manage')
  updateRole(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(roleInputSchema)) body: RoleInput, @Meta() meta: RequestMeta) {
    return this.roleService.update(auth, id, body, meta);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermissions('members:manage')
  deleteRole(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.roleService.remove(auth, id, meta);
  }

  @Patch('members/:membershipId/role')
  @RequirePermissions('members:manage')
  changeRole(
    @Auth() auth: AuthContext,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body(new ZodPipe(updateMemberRoleSchema)) body: UpdateMemberRoleInput,
    @Meta() meta: RequestMeta,
  ) {
    return this.tenants.changeMemberRole(auth, membershipId, body.roleKey, meta);
  }

  @Get('invitations')
  @RequirePermissions('members:read')
  listInvitations(@Auth() auth: AuthContext) {
    return this.invitations.list(auth);
  }

  @Post('invitations')
  @RequirePermissions('members:manage')
  invite(@Auth() auth: AuthContext, @Body(new ZodPipe(invitationInputSchema)) body: InvitationInput, @Meta() meta: RequestMeta) {
    return this.invitations.create(auth, body, meta);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermissions('members:manage')
  revokeInvitation(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.invitations.revoke(auth, id, meta);
  }
}
