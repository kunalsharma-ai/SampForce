import { Module } from '@nestjs/common';
import { ConsoleNotificationSweep, ConsoleNotifier } from './console-notifications.service';

/** Console notifications (ADR 0074, C3b): delivery and the worker's sweep, shared by the API and the worker. */
@Module({ providers: [ConsoleNotifier, ConsoleNotificationSweep], exports: [ConsoleNotifier, ConsoleNotificationSweep] })
export class ConsoleNotificationsModule {}
