import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { OperatorGuard, OperatorTokens } from '../operator/operator-auth';
import { HelpController } from './help.controller';
import { OperatorSupportController, SupportAttachmentsController, SupportController } from './support.controller';
import { SupportService } from './support.service';

/** The Help Center's API and its support tickets (ADR 0073). */
@Module({
  controllers: [HelpController, SupportController, SupportAttachmentsController, OperatorSupportController],
  providers: [SupportService, NotificationsService, OperatorTokens, OperatorGuard],
})
export class SupportModule {}
