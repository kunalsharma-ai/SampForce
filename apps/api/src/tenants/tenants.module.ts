import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { RolesService } from './roles.service';
import { TenantsController } from './tenants.controller';
import { TeamsService } from './teams.service';
import { TenantsService } from './tenants.service';

@Module({ controllers: [TenantsController], providers: [TenantsService, InvitationsService, RolesService, TeamsService] })
export class TenantsModule {}
