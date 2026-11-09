import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { type DocusignSendInput, docusignListQuery, docusignSendSchema, docusignVoidSchema, type z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AppError } from './apps.service';
import { DocusignService } from './docusign.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Contracts sent for e-signature through DocuSign, and DocuSign Connect status events. */
@Controller('apps/docusign')
@RequireFeature('docusign')
export class DocusignController {
  constructor(private readonly docusign: DocusignService) {}

  /** Emails the contract to the signer through the workspace's DocuSign account. The body must carry confirm: true. */
  @Post('envelopes')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('contracts:write')
  send(@Auth() auth: AuthContext, @Body(new ZodPipe(docusignSendSchema)) body: DocusignSendInput, @Meta() meta: RequestMeta) {
    return wrap(() => this.docusign.send(auth, body, meta));
  }

  @Get('envelopes')
  @RequirePermissions('contracts:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(docusignListQuery)) q: z.infer<typeof docusignListQuery>) {
    return this.docusign.list(auth, q.contractId);
  }

  @Post('envelopes/:id/void')
  @HttpCode(200)
  @RequirePermissions('contracts:write')
  void(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(docusignVoidSchema)) body: z.infer<typeof docusignVoidSchema>, @Meta() meta: RequestMeta) {
    return wrap(() => this.docusign.void(auth, id, body.reason, meta));
  }

  @Post('envelopes/:id/check')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions('contracts:read')
  check(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return wrap(() => this.docusign.check(auth, id));
  }

  @Get('envelopes/:id/document')
  @RequirePermissions('contracts:read')
  async document(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    const { pdf, filename } = await wrap(() => this.docusign.signedDocument(auth, id));
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('cache-control', 'private, no-store');
    res.end(pdf);
  }

  /** DocuSign Connect: authenticated by HMAC only. */
  @Post('events')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  events(@Req() req: RawBodyRequest<Request>) {
    return this.docusign.handleConnect(req.rawBody, req.headers);
  }
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw new BadRequestException({ code: 'APP_ERROR', message: e.message });
    throw e;
  }
}
