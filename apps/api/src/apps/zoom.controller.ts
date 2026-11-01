import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { type ZoomMeetingCreate, zoomMeetingCreateSchema, zoomMeetingListQuery, type z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AppError } from './apps.service';
import { ZoomService } from './zoom.service';

/** Zoom meetings scheduled from records, and Zoom's event notifications. */
@Controller('apps/zoom')
export class ZoomController {
  constructor(private readonly zoom: ZoomService) {}

  /** Schedules a meeting in the signed-in person's Zoom user (by their DealFlow email) and logs it on the record. */
  @Post('meetings')
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions('activities:write')
  async schedule(@Auth() auth: AuthContext, @Body(new ZodPipe(zoomMeetingCreateSchema)) body: ZoomMeetingCreate, @Meta() meta: RequestMeta) {
    try {
      return await this.zoom.schedule(auth, body, meta);
    } catch (e) {
      if (e instanceof AppError) throw new BadRequestException({ code: 'APP_ERROR', message: e.message });
      throw e;
    }
  }

  @Get('meetings')
  @RequirePermissions('activities:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(zoomMeetingListQuery)) q: z.infer<typeof zoomMeetingListQuery>) {
    return this.zoom.list(auth, q);
  }

  /** Zoom event notifications (transcript ready, app removed, URL validation): authenticated by signature only. */
  @Post('events')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  events(@Req() req: RawBodyRequest<Request>) {
    return this.zoom.handleEvent(req.rawBody, req.headers);
  }
}
