import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type AnnouncementInput, announcementInputSchema } from '@dealflow/types';
import { Auth, type AuthContext, Meta, MobileAccess, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AnnouncementsService } from './announcements.service';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  /** Everyone in the organisation reads them, on the web and the phone. */
  @MobileAccess()
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.announcements.list(auth);
  }

  /** Posted by the organisation's administrators. */
  @Post()
  @RequirePermissions('tenant:manage')
  post(@Auth() auth: AuthContext, @Body(new ZodPipe(announcementInputSchema)) body: AnnouncementInput, @Meta() meta: RequestMeta) {
    return this.announcements.post(auth, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('tenant:manage')
  remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.announcements.remove(auth, id, meta);
  }
}
