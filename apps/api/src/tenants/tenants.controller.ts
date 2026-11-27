import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  type InvitationInput,
  type RoleInput,
  type TeamInput,
  teamInputSchema,
  roleInputSchema,
  invitationInputSchema,
  type UpdateMemberRoleInput,
  updateMemberRoleSchema,
  type UpdateTenantInput,
  updateTenantSchema,
  type MemberOrgInput,
  memberOrgSchema,
  type RoleVisibilityInput,
  roleVisibilitySchema,
  type RemoveMemberInput,
  removeMemberSchema,
  type SalesProfileInput,
  salesProfileSchema,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions, AlsoRequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { InvitationsService } from './invitations.service';
import { MemberRemovalService } from './member-removal.service';
import { RolesService } from './roles.service';
import { TeamsService } from './teams.service';
import { TenantsService } from './tenants.service';
import { ConfirmPassword, NoPasswordConfirmation } from '../common/password-confirmation';

@Controller('tenants/current')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly invitations: InvitationsService,
    private readonly roleService: RolesService,
    private readonly teams: TeamsService,
    private readonly removal: MemberRemovalService,
  ) {}

  @Get('teams')
  @RequirePermissions('members:read')
  listTeams(@Auth() auth: AuthContext) {
    return this.teams.list(auth);
  }

  @Post('teams')
  @RequirePermissions('members:manage')
  createTeam(@Auth() auth: AuthContext, @Body(new ZodPipe(teamInputSchema)) body: TeamInput, @Meta() meta: RequestMeta) {
    return this.teams.create(auth, body, meta);
  }

  @Put('teams/:id')
  @RequirePermissions('members:manage')
  updateTeam(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(teamInputSchema)) body: TeamInput, @Meta() meta: RequestMeta) {
    return this.teams.update(auth, id, body, meta);
  }

  @ConfirmPassword()
  @Delete('teams/:id')
  @HttpCode(204)
  @RequirePermissions('members:manage')
  removeTeam(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.teams.remove(auth, id, meta);
  }

  @Get('menu-sections')
  @RequirePermissions('tenant:read')
  menuSections(@Auth() auth: AuthContext) {
    return this.tenants.menuSections(auth);
  }


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

  @Get('sales-profile')
  @RequirePermissions('tenant:read')
  salesProfile(@Auth() auth: AuthContext) {
    return this.tenants.salesProfile(auth);
  }

  @Put('sales-profile')
  @RequirePermissions('tenant:manage')
  setSalesProfile(@Auth() auth: AuthContext, @Body(new ZodPipe(salesProfileSchema)) body: SalesProfileInput, @Meta() meta: RequestMeta) {
    return this.tenants.setSalesProfile(auth, body, meta);
  }

  @Get('members')
  @RequirePermissions('members:read')
  members(@Auth() auth: AuthContext) {
    return this.tenants.members(auth);
  }

  @Get('roles')
  @AlsoRequireFeature('permission_management')
  @RequirePermissions('members:read')
  roles(@Auth() auth: AuthContext) {
    return this.roleService.list(auth);
  }

  @Post('roles')
  @AlsoRequireFeature('permission_management')
  @RequirePermissions('members:manage')
  createRole(@Auth() auth: AuthContext, @Body(new ZodPipe(roleInputSchema)) body: RoleInput, @Meta() meta: RequestMeta) {
    return this.roleService.create(auth, body, meta);
  }

  @Put('roles/:id')
  @AlsoRequireFeature('permission_management')
  @RequirePermissions('members:manage')
  updateRole(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(roleInputSchema)) body: RoleInput, @Meta() meta: RequestMeta) {
    return this.roleService.update(auth, id, body, meta);
  }

  @Put('roles/:id/visibility')
  @AlsoRequireFeature('permission_management')
  @RequirePermissions('members:manage')
  setRoleVisibility(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(roleVisibilitySchema)) body: RoleVisibilityInput, @Meta() meta: RequestMeta) {
    return this.roleService.setVisibility(auth, id, body, meta);
  }

  /** Designation, department and reporting manager (company-centric CRM). */
  @Patch('members/:membershipId/org')
  @RequirePermissions('members:manage')
  setMemberOrg(@Auth() auth: AuthContext, @Param('membershipId', new ParseUUIDPipe()) membershipId: string, @Body(new ZodPipe(memberOrgSchema)) body: MemberOrgInput, @Meta() meta: RequestMeta) {
    return this.tenants.setMemberOrg(auth, membershipId, body, meta);
  }

  @ConfirmPassword()
  @Delete('roles/:id')
  @AlsoRequireFeature('permission_management')
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

  /** What removing a person would move and delete, shown before the owner confirms. */
  @Get('members/:membershipId/removal')
  @RequirePermissions('members:manage')
  removalImpact(@Auth() auth: AuthContext, @Param('membershipId', new ParseUUIDPipe()) membershipId: string) {
    return this.removal.impact(auth, membershipId);
  }

  /** Removes a person from the workspace completely: records handed over, sign-in stopped, invitations deleted. */
  @ConfirmPassword()
  @Delete('members/:membershipId')
  @RequirePermissions('members:manage')
  removeMember(
    @Auth() auth: AuthContext,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body(new ZodPipe(removeMemberSchema)) body: RemoveMemberInput,
    @Meta() meta: RequestMeta,
  ) {
    return this.removal.remove(auth, membershipId, body ?? {}, meta);
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

  @NoPasswordConfirmation('Cancels an invitation; withdrawing access must stay quick')
  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermissions('members:manage')
  revokeInvitation(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.invitations.revoke(auth, id, meta);
  }

  /** Deletes an invitation row for good (accepted, revoked, expired or pending). */
  @ConfirmPassword()
  @Delete('invitations/:id/record')
  @HttpCode(204)
  @RequirePermissions('members:manage')
  deleteInvitation(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.invitations.erase(auth, id, meta);
  }
}
