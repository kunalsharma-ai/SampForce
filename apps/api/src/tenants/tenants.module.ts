import { Module } from '@nestjs/common';
import { CompanyClosureController } from './company-closure.controller';
import { CompanyClosureService } from './company-closure.service';
import { InvitationsService } from './invitations.service';
import { MemberRemovalService } from './member-removal.service';
import { RolesService } from './roles.service';
import { TenantsController } from './tenants.controller';
import { TeamsService } from './teams.service';
import { TenantsService } from './tenants.service';

@Module({ controllers: [TenantsController, CompanyClosureController], providers: [TenantsService, InvitationsService, RolesService, TeamsService, CompanyClosureService, MemberRemovalService], exports: [InvitationsService] })
export class TenantsModule {}
