import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { OperatorGuard, OperatorTokens } from '../operator/operator-auth';
import { HelpController } from './help.controller';
import { HelpContentController, OperatorHelpController } from './help-content.controller';
import { HelpContentService } from './help-content.service';
import { OperatorSupportController, SupportAttachmentsController, SupportController } from './support.controller';
import { SupportService } from './support.service';

/** The Help Center's API and its support tickets (ADR 0073). */
@Module({
  controllers: [HelpController, HelpContentController, OperatorHelpController, SupportController, SupportAttachmentsController, OperatorSupportController],
  providers: [SupportService, HelpContentService, NotificationsService, OperatorTokens, OperatorGuard],
})
export class SupportModule {}
