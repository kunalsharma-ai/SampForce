import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from '@dealflow/types';
import { Auth, type AuthContext, AlsoRequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { MobileModuleAccess } from '../mobile/mobile-module.guard';
import { NotificationsService } from './notifications.service';

const listQuery = z.object({ unread: z.enum(['true', 'false']).default('false') });
const readBody = z.object({ ids: z.union([z.literal('all'), z.array(z.string().uuid()).min(1).max(100)]) });

/** Personal inbox: every signed-in member can read and clear their own notifications. */
@Controller('notifications')
@AlsoRequireFeature('notifications')
// The phone's Notifications screen (ADR 0072, M8), while the person's Mobile Configuration has it.
@MobileModuleAccess('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.notifications.list(auth, q.unread === 'true');
  }

  @Post('read')
  @HttpCode(200)
  read(@Auth() auth: AuthContext, @Body(new ZodPipe(readBody)) body: z.infer<typeof readBody>) {
    return this.notifications.markRead(auth, body.ids);
  }
}
