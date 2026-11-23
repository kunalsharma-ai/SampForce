import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { type OperatorNotificationPrefsInput, operatorNotificationPrefsSchema, type OperatorNotificationQuery, operatorNotificationQuerySchema } from '@dealflow/types';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ConsoleNotifier } from './console-notifications.service';
import { Operator, OperatorAny, type OperatorContext, OperatorGuard, OperatorNoAudit } from './operator-auth';

/**
 * The signed-in operator's own Console notifications and how they want each type (ADR 0074, C3b). Reading and
 * choosing change nothing on the platform, so these writes are not audit entries.
 */
@Controller('operator/me')
@Public()
@UseGuards(OperatorGuard)
@OperatorAny()
export class ConsoleNotificationsController {
  constructor(private readonly notifier: ConsoleNotifier) {}

  @Get('notifications')
  list(@Operator() op: OperatorContext, @Query(new ZodPipe(operatorNotificationQuerySchema)) q: OperatorNotificationQuery) {
    return this.notifier.list(op.id, q);
  }

  @Get('notifications/unread')
  async unread(@Operator() op: OperatorContext) {
    return { unread: await this.notifier.unread(op.id) };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  @OperatorNoAudit()
  readAll(@Operator() op: OperatorContext) {
    return this.notifier.markAllRead(op.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  @OperatorNoAudit()
  read(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifier.markRead(op.id, id);
  }

  @Get('notification-preferences')
  prefs(@Operator() op: OperatorContext) {
    return this.notifier.prefs(op.id, op.permissions);
  }

  @Put('notification-preferences')
  @OperatorNoAudit()
  setPrefs(@Operator() op: OperatorContext, @Body(new ZodPipe(operatorNotificationPrefsSchema)) body: OperatorNotificationPrefsInput) {
    return this.notifier.setPrefs(op.id, op.permissions, body);
  }
}
