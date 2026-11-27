import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  type EnquiryConvertInput,
  enquiryConvertSchema,
  type EnquiryListQuery,
  enquiryListQuerySchema,
  type EnquiryUpdateInput,
  enquiryUpdateSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { WebsiteEnquiriesService } from './website-enquiries.service';
import { WebsiteEnquirySync } from './website-enquiry-sync.service';

const uuid = new ParseUUIDPipe();
const recordQuery = z.object({ contactId: z.string().uuid().optional(), companyId: z.string().uuid().optional() });

/** The Website Enquiry section (ADR 0095). */
@Controller('website-enquiries')
@RequireFeature('website_enquiries')
export class WebsiteEnquiriesController {
  constructor(
    private readonly enquiries: WebsiteEnquiriesService,
    private readonly sync: WebsiteEnquirySync,
  ) {}

  @Get('summary')
  @RequirePermissions('enquiries:read')
  async summary(@Auth() auth: AuthContext) {
    return this.enquiries.summary(auth, await this.sync.status());
  }

  @Get('record')
  @RequirePermissions('enquiries:read')
  forRecord(@Auth() auth: AuthContext, @Query(new ZodPipe(recordQuery)) q: z.infer<typeof recordQuery>) {
    return this.enquiries.forRecord(auth, q);
  }

  @Get()
  @RequirePermissions('enquiries:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(enquiryListQuerySchema)) q: EnquiryListQuery) {
    return this.enquiries.list(auth, q);
  }

  @Post('sync')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @RequirePermissions('enquiries:write')
  syncNow(@Auth() auth: AuthContext) {
    return this.sync.syncNow(auth.tenantId);
  }

  @Post('seen')
  @HttpCode(200)
  @RequirePermissions('enquiries:read')
  markAllSeen(@Auth() auth: AuthContext, @Body(new ZodPipe(enquiryListQuerySchema)) q: EnquiryListQuery) {
    return this.enquiries.markAllSeen(auth, q);
  }

  @Get(':id')
  @RequirePermissions('enquiries:read')
  detail(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.enquiries.detail(auth, id);
  }

  @Post(':id/unread')
  @HttpCode(200)
  @RequirePermissions('enquiries:read')
  unread(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.enquiries.markUnread(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('enquiries:write')
  async update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(enquiryUpdateSchema)) body: EnquiryUpdateInput, @Meta() meta: RequestMeta) {
    const out = await this.enquiries.update(auth, id, body, meta);
    // The website hears about it at once; the worker retries if it is down.
    if (out.writeBack.state === 'waiting') void this.sync.flushWriteBacks(auth.tenantId).catch(() => undefined);
    return out;
  }

  @Post(':id/convert')
  @HttpCode(200)
  @RequirePermissions('enquiries:write')
  async convert(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(enquiryConvertSchema)) body: EnquiryConvertInput, @Meta() meta: RequestMeta) {
    const out = await this.enquiries.convert(auth, id, body, meta);
    if (out.enquiry.writeBack.state === 'waiting') void this.sync.flushWriteBacks(auth.tenantId).catch(() => undefined);
    return out;
  }
}

/** The website's signed webhook: authenticated by its HMAC signature only (ADR 0095). */
@Controller('hooks')
export class WebsiteEnquiryHookController {
  constructor(private readonly enquiries: WebsiteEnquiriesService) {}

  @Post('website-enquiries')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>) {
    return this.enquiries.handleWebhook(req.rawBody, req.headers);
  }
}
