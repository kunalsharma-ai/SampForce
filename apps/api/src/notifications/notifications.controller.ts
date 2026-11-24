import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  type NotificationPageQuery,
  notificationPageQuerySchema,
  type NotificationPreferences,
  notificationPreferencesSchema,
  type NotificationReadInput,
  notificationReadSchema,
  notificationWaitQuerySchema,
  z,
} from '@dealflow/types';
import type { Request } from 'express';
import { Auth, type AuthContext, AlsoRequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { MobileModuleAccess } from '../mobile/mobile-module.guard';
import { NotificationsService } from './notifications.service';

/** Settles when the browser gives up on a held request, so the server stops waiting for it. */
function closedOf(req: Request): Promise<void> {
  return new Promise((resolve) => req.on('close', () => resolve()));
}

/**
 * Personal inbox (ADR 0075): every signed-in member reads and clears only their own notifications, in every
 * workspace level and on the phone. The same rows feed the bell, the home dashboard and each section.
 */
@Controller('notifications')
@AlsoRequireFeature('notifications')
// The phone's Notifications screen (ADR 0072, M8), while the person's Mobile Configuration has it.
@MobileModuleAccess('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(notificationPageQuerySchema)) q: NotificationPageQuery) {
    return this.notifications.page(auth, q);
  }

  @Get('summary')
  summary(@Auth() auth: AuthContext) {
    return this.notifications.summary(auth);
  }

  /** Held open until something new arrives (or `wait` seconds): the live part of the bell. */
  @Get('wait')
  wait(@Auth() auth: AuthContext, @Query(new ZodPipe(notificationWaitQuerySchema)) q: z.infer<typeof notificationWaitQuerySchema>, @Req() req: Request) {
    return this.notifications.wait(auth, q.after, q.wait, closedOf(req));
  }

  @Post('read')
  @HttpCode(200)
  read(@Auth() auth: AuthContext, @Body(new ZodPipe(notificationReadSchema)) body: NotificationReadInput) {
    return this.notifications.markRead(auth, body);
  }

  @Post(':id/unread')
  @HttpCode(200)
  unread(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markUnread(auth, id);
  }

  @Get('preferences')
  preferences(@Auth() auth: AuthContext) {
    return this.notifications.preferences(auth);
  }

  @Put('preferences')
  savePreferences(@Auth() auth: AuthContext, @Body(new ZodPipe(notificationPreferencesSchema)) body: NotificationPreferences) {
    return this.notifications.savePreferences(auth, body);
  }
}
