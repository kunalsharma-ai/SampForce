import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  type UpdateMemberRoleInput,
  updateMemberRoleSchema,
  type UpdateTenantInput,
  updateTenantSchema,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { TenantsService } from './tenants.service';

@Controller('tenants/current')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

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
    return this.tenants.roles(auth);
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
}
