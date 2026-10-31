import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationModule } from '../automation/automation.module';
import { CommercialModule } from '../commercial/commercial.module';
import { MailModule } from '../mail/mail.module';
import { PortalAdminService } from './portal-admin.service';
import { PortalAuthService } from './portal-auth.service';
import { ClientPortalController, PortalAdminController } from './portal.controller';
import { DocumentLinks } from './portal-documents';
import { PortalService } from './portal.service';

/** Enhancement feature 11: the client self-service portal (ADR 0025). */
@Module({
  imports: [AuthModule, MailModule, AutomationModule, CommercialModule],
  controllers: [ClientPortalController, PortalAdminController],
  providers: [PortalAuthService, PortalService, PortalAdminService, DocumentLinks],
})
export class PortalModule {}
