import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  type CampaignInput,
  campaignInputSchema,
  type LeadFormInput,
  leadFormInputSchema,
  type SegmentInput,
  segmentInputSchema,
  segmentRulesSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, type AuthedRequest, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { CampaignsService } from './campaigns.service';
import { FormsService } from './forms.service';
import { SegmentsService } from './segments.service';

const uuid = new ParseUUIDPipe();
const previewBody = z.object({ entity: z.enum(['lead', 'contact']), rules: segmentRulesSchema });
const exportQuery = z.object({ optedInOnly: z.enum(['true', 'false']).default('true') });

@Controller('segments')
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  @RequirePermissions('marketing:read')
  list(@Auth() auth: AuthContext) {
    return this.segments.list(auth);
  }

  @Post()
  @RequirePermissions('marketing:manage')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(segmentInputSchema)) body: SegmentInput, @Meta() meta: RequestMeta) {
    return this.segments.save(auth, null, body, meta);
  }

  @Put(':id')
  @RequirePermissions('marketing:manage')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(segmentInputSchema)) body: SegmentInput, @Meta() meta: RequestMeta) {
    return this.segments.save(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('marketing:manage')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.segments.remove(auth, id, meta);
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions('marketing:read')
  preview(@Auth() auth: AuthContext, @Body(new ZodPipe(previewBody)) body: z.infer<typeof previewBody>) {
    return this.segments.preview(auth, body.entity, body.rules);
  }

  @Get(':id/preview')
  @RequirePermissions('marketing:read')
  previewSaved(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.segments.previewSaved(auth, id);
  }

  @Get(':id/export')
  @RequirePermissions('marketing:read', 'data:export')
  async export(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query(new ZodPipe(exportQuery)) q: z.infer<typeof exportQuery>, @Meta() meta: RequestMeta, @Res() res: Response) {
    const { filename, csv } = await this.segments.exportCsv(auth, id, q.optedInOnly === 'true', meta);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.end(csv);
  }
}

@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  @RequirePermissions('marketing:read')
  list(@Auth() auth: AuthContext) {
    return this.forms.list(auth);
  }

  @Post()
  @RequirePermissions('marketing:manage')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(leadFormInputSchema)) body: LeadFormInput, @Meta() meta: RequestMeta) {
    return this.forms.save(auth, null, body, meta);
  }

  @Put(':id')
  @RequirePermissions('marketing:manage')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(leadFormInputSchema)) body: LeadFormInput, @Meta() meta: RequestMeta) {
    return this.forms.save(auth, id, body, meta);
  }

  @Get(':id/submissions')
  @RequirePermissions('marketing:read', 'leads:read')
  submissions(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.forms.submissions(auth, id);
  }
}

/** Unauthenticated endpoints behind the hosted form page. Throttled per client on top of the per-IP submission cap. */
@Controller('public/forms')
export class PublicFormsController {
  constructor(private readonly forms: FormsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  view(@Param('token') token: string) {
    return this.forms.publicView(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token')
  @HttpCode(200)
  submit(@Param('token') token: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.forms.submit(token, body, req.ip ?? null);
  }
}

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermissions('marketing:read')
  list(@Auth() auth: AuthContext) {
    return this.campaigns.list(auth);
  }

  @Get(':id')
  @RequirePermissions('marketing:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.campaigns.get(auth, id);
  }

  @Post()
  @RequirePermissions('marketing:manage')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(campaignInputSchema)) body: CampaignInput, @Meta() meta: RequestMeta) {
    return this.campaigns.save(auth, null, body, meta);
  }

  @Put(':id')
  @RequirePermissions('marketing:manage')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(campaignInputSchema)) body: CampaignInput, @Meta() meta: RequestMeta) {
    return this.campaigns.save(auth, id, body, meta);
  }
}
