import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({ controllers: [TenantsController], providers: [TenantsService, InvitationsService] })
export class TenantsModule {}
