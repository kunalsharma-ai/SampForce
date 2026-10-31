import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VISITOR_DASHBOARD_DAYS, visitorSettingsSchema, z } from '@dealflow/types';
import type { Request, Response } from 'express';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { CrossSite } from '../common/origin.guard';
import { ZodPipe } from '../common/zod.pipe';
import { TRACKER_SCRIPT } from './tracker-script';
import { VisitorsService } from './visitors.service';

const uuid = new ParseUUIDPipe();
const listQuery = z.object({ segment: z.enum(['all', 'identified', 'anonymous', 'high_intent']).default('all'), search: z.string().trim().max(100).optional() });
const dashboardQuery = z.object({ days: z.coerce.number().int().refine((d) => (VISITOR_DASHBOARD_DAYS as readonly number[]).includes(d), 'Use 7, 30 or 90').default(30) });
const recordQuery = z.object({ type: z.enum(['lead', 'contact']), id: z.string().uuid() });

@Controller('visitors')
export class VisitorsController {
  constructor(private readonly visitors: VisitorsService) {}

  @Get('settings')
  @RequirePermissions('visitors:read')
  settings(@Auth() auth: AuthContext) {
    return this.visitors.settings(auth);
  }

  @Put('settings')
  @RequirePermissions('visitors:manage')
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(visitorSettingsSchema)) body: z.infer<typeof visitorSettingsSchema>, @Meta() meta: RequestMeta) {
    return this.visitors.saveSettings(auth, body, meta);
  }

  @Post('settings/rotate-key')
  @HttpCode(200)
  @RequirePermissions('visitors:manage')
  rotate(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.visitors.rotateKey(auth, meta);
  }

  @Get('dashboard')
  @RequirePermissions('visitors:read')
  dashboard(@Auth() auth: AuthContext, @Query(new ZodPipe(dashboardQuery)) q: z.infer<typeof dashboardQuery>) {
    return this.visitors.dashboard(auth, q.days);
  }

  @Get('record')
  @RequirePermissions('visitors:read')
  record(@Auth() auth: AuthContext, @Query(new ZodPipe(recordQuery)) q: z.infer<typeof recordQuery>) {
    return this.visitors.forRecord(auth, q.type, q.id);
  }

  @Get()
  @RequirePermissions('visitors:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.visitors.list(auth, q);
  }

  @Get(':id')
  @RequirePermissions('visitors:read')
  detail(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.visitors.detail(auth, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('visitors:manage')
  erase(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.visitors.erase(auth, id, meta);
  }
}

/**
 * Endpoints the tracking script calls from customers' websites. No cookies are read or set. Requests whose Origin is
 * not on the workspace's allowed list are refused, and only allowed origins get a CORS header back.
 */
@Controller('public/track')
@CrossSite()
export class PublicTrackingController {
  constructor(private readonly visitors: VisitorsService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('script.js')
  @Header('content-type', 'application/javascript; charset=utf-8')
  @Header('cache-control', 'public, max-age=3600')
  @Header('cross-origin-resource-policy', 'cross-origin')
  script() {
    return TRACKER_SCRIPT;
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':siteKey/config')
  async config(@Param('siteKey') key: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.visitors.publicConfig(key, req.get('origin'));
    allowOrigin(req, res);
    return out;
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post(':siteKey/collect')
  @HttpCode(200)
  async collect(@Param('siteKey') key: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const privacy = req.get('sec-gpc') === '1' || req.get('dnt') === '1';
    const out = await this.visitors.collect(key, req.get('origin'), body, privacy);
    allowOrigin(req, res);
    return out;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':siteKey/enquiry')
  @HttpCode(200)
  async enquiry(@Param('siteKey') key: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Check the site first so validation errors can be read by the allowed website's script.
    await this.visitors.publicConfig(key, req.get('origin'));
    allowOrigin(req, res);
    return this.visitors.enquiry(key, req.get('origin'), body, req.ip ?? null);
  }
}

/** Echoes the Origin; the service has already refused origins that are not on the allowed list. */
function allowOrigin(req: Request, res: Response) {
  const origin = req.get('origin');
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
  }
}
