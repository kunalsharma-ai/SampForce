import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { OperatorGuard, OperatorTokens } from '../operator/operator-auth';
import { OperatorSessions } from '../operator/operator-sessions';
import { HelpController } from './help.controller';
import { HelpContentController, OperatorHelpController } from './help-content.controller';
import { HelpContentService } from './help-content.service';
import { OperatorSupportController, SupportAttachmentsController, SupportController } from './support.controller';
import { SupportService } from './support.service';
import { OperatorSiteSupportController, SiteSupportController } from './site-support.controller';
import { SiteSupportService } from './site-support.service';

/** The Help Center's API, its support tickets (ADR 0073) and the public website's Help & Support messages (ADR 0078). */
@Module({
  controllers: [HelpController, HelpContentController, OperatorHelpController, SupportController, SupportAttachmentsController, OperatorSupportController, SiteSupportController, OperatorSiteSupportController],
  providers: [SupportService, SiteSupportService, HelpContentService, NotificationsService, OperatorTokens, OperatorGuard, OperatorSessions],
})
export class SupportModule {}
