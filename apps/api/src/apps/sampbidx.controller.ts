import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, PayloadTooLargeException, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  SAMPBIDX_ATTACHMENT_MAX_BYTES,
  SAMPBIDX_EMAIL_FILE_MAX_BYTES,
  type SampbidxPastedCheckInput,
  sampbidxPastedCheckSchema,
  type SampbidxConnectInput,
  sampbidxConnectSchema,
  type SampbidxEmailFileQuery,
  sampbidxEmailFileQuerySchema,
  sampbidxMailboxQuerySchema,
  type SampbidxSendMailboxEmailInput,
  sampbidxSendMailboxEmailSchema,
  type SampbidxPastedEmail,
  sampbidxSendPastedEmailSchema,
  type SampbidxSendRfqInput,
  sampbidxSendRfqSchema,
  sampbidxCompanyPreviewQuerySchema,
  sampbidxSendCompanySchema,
  type SampbidxTransferListQuery,
  sampbidxTransferListQuerySchema,
  sampbidxBatchInputSchema,
  sampbidxDiagnoseSchema,
  type SampbidxDiagnoseInput,
} from '@dealflow/types';
import type { z } from 'zod';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { NoPasswordConfirmation } from '../common/password-confirmation';
import { AppError } from './apps.service';
import { SampbidxBulkService } from './sampbidx-bulk.service';
import { SampbidxService } from './sampbidx.service';

type BatchBody = z.output<typeof sampbidxBatchInputSchema>;

/** Deals need deals:write and won companies companies:write, besides contacts:write for typed-in details. */
function assertBatchAllowed(auth: AuthContext, body: Pick<BatchBody, 'kind'>) {
  const need = [body.kind === 'DEALS' ? 'deals:write' : 'companies:write', 'contacts:write'];
  const missing = need.filter((p) => !auth.permissions.includes(p));
  if (missing.length) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role does not allow this action.', details: missing.map((p) => ({ path: 'permission', message: p })) });
}

const uuid = new ParseUUIDPipe({ version: '4' });

async function plain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw new BadRequestException({ code: 'APP_ERROR', message: e.message });
    throw e;
  }
}

/** Reads an uploaded file sent as the raw request body, up to a limit (the email file limit unless given). */
async function readEmailFile(req: Request, max = SAMPBIDX_EMAIL_FILE_MAX_BYTES, tooBigMessage = 'Email files can be up to 10 MB.'): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  const tooBig = () => new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: tooBigMessage });
  if (Number.isFinite(declared) && declared > max) throw tooBig();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw tooBig();
    chunks.push(chunk);
  }
  if (!size) throw new BadRequestException({ code: 'EMPTY_FILE', message: 'The file is empty.' });
  return Buffer.concat(chunks);
}

/** SampBidx (ADR 0061): the connection, sending RFQs and RFQ emails, the transfer history, and SampBidx's callbacks. */
@Controller('apps/sampbidx')
@RequireFeature('sampbidx')
export class SampbidxController {
  constructor(
    private readonly sampbidx: SampbidxService,
    private readonly bulk: SampbidxBulkService,
  ) {}

  // ─── Settings page and bulk sends (ADR 0095) ───

  /** The settings page: the saved connection as it is, sync counts, recent errors and bulk sends. Never the key. */
  @Get('overview')
  @RequirePermissions('integrations:manage')
  overview(@Auth() auth: AuthContext) {
    return this.bulk.overview(auth);
  }

  /** Test connection, step by step. Typed-in values are tried and not saved; with none, the saved connection is tested. */
  @Post('diagnose')
  @HttpCode(200)
  @Throttle({ default: { limit: () => Number(process.env.SAMPBIDX_KEYS_PER_MINUTE ?? 10), ttl: 60_000 } })
  @RequirePermissions('integrations:manage')
  diagnose(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxDiagnoseSchema)) body: SampbidxDiagnoseInput) {
    return this.bulk.diagnose(auth, body);
  }

  /** Checks the chosen deals or won companies: ready, needs a detail typed in, or skipped with the reason. Sends nothing. */
  @Post('batches/preview')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  preview(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxBatchInputSchema)) body: BatchBody) {
    assertBatchAllowed(auth, body);
    return this.bulk.preview(auth, body);
  }

  /** Saves the typed details and starts sending in the background; poll GET batches/:id for progress. */
  @Post('batches')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxBatchInputSchema)) body: BatchBody, @Meta() meta: RequestMeta) {
    assertBatchAllowed(auth, body);
    return this.bulk.start(auth, body, meta);
  }

  @Get('batches')
  @RequirePermissions('companies:read')
  batches(@Auth() auth: AuthContext) {
    return this.bulk.list(auth, 20);
  }

  @Get('batches/:id')
  @SkipThrottle()
  @RequirePermissions('companies:read')
  batch(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.bulk.get(auth, id);
  }

  /** Sends the failed items again, with the same Idempotency-Keys. */
  @Post('batches/:id/retry')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('companies:read')
  retryBatch(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.bulk.retry(auth, id, meta);
  }

  /** Saves the API address and key after GET /v1/ping accepts them. Sends no RFQ. */
  @Post('keys')
  @HttpCode(200)
  // Five key checks a minute from one address. Browser tests share one address, so they raise it.
  @Throttle({ default: { limit: () => Number(process.env.SAMPBIDX_KEYS_PER_MINUTE ?? 5), ttl: 60_000 } })
  @RequirePermissions('integrations:manage')
  keys(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxConnectSchema)) body: SampbidxConnectInput, @Meta() meta: RequestMeta) {
    return plain(() => this.sampbidx.connect(auth, body, meta));
  }

  @Get('callback-secret')
  @RequirePermissions('integrations:manage')
  secret(@Auth() auth: AuthContext) {
    return this.sampbidx.callbackSecret(auth);
  }

  @Post('callback-secret/rotate')
  @HttpCode(200)
  @RequirePermissions('integrations:manage')
  rotate(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.sampbidx.rotateCallbackSecret(auth, meta);
  }

  /** What "Send to SampBidx" checks for one RFQ: missing details, its files, and earlier sends. */
  @Get('rfqs/:rfqId')
  @RequirePermissions('companies:read')
  readiness(@Auth() auth: AuthContext, @Param('rfqId', uuid) rfqId: string) {
    return this.sampbidx.readiness(auth, rfqId);
  }

  /** Option 1: the RFQ's details and the chosen attachments. */
  @Post('transfers/rfq')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions('companies:write')
  sendRfq(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxSendRfqSchema)) body: SampbidxSendRfqInput, @Meta() meta: RequestMeta) {
    return this.sampbidx.sendRfq(auth, body, meta);
  }

  /** "Send to SampBidx" on a company (ADR 0080): the client, employees, chosen RFQ, and what blocks sending. */
  @Get('companies/:companyId/preview')
  @RequirePermissions('companies:read', 'contacts:read')
  companyPreview(@Auth() auth: AuthContext, @Param('companyId', uuid) companyId: string, @Query(new ZodPipe(sampbidxCompanyPreviewQuerySchema)) q: z.output<typeof sampbidxCompanyPreviewQuerySchema>) {
    return this.sampbidx.companyPreview(auth, companyId, q);
  }

  /** Sends the company as a SampBidx client with the picked employees, then the chosen RFQ. */
  @Post('transfers/company')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions('companies:write', 'contacts:write')
  sendCompany(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxSendCompanySchema)) body: z.output<typeof sampbidxSendCompanySchema>, @Meta() meta: RequestMeta) {
    return this.sampbidx.sendCompany(auth, body, meta);
  }

  /** Emails from the person's own connected mailboxes, to choose one to transfer. */
  @Get('mailbox')
  @RequirePermissions('activities:read')
  mailbox(@Auth() auth: AuthContext, @Query(new ZodPipe(sampbidxMailboxQuerySchema)) q: z.output<typeof sampbidxMailboxQuerySchema>) {
    return this.sampbidx.mailbox(auth, q);
  }

  /** Option 2a: an email from the synced mailbox. */
  @Post('transfers/mailbox-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions('activities:read')
  sendMailbox(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxSendMailboxEmailSchema)) body: SampbidxSendMailboxEmailInput, @Meta() meta: RequestMeta) {
    return this.sampbidx.sendMailboxEmail(auth, body, meta);
  }

  /** Before sending pasted text: subject, sender and date read from it, the client it would be linked to, and earlier sends of it. */
  @Post('pasted-email/check')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @RequirePermissions('activities:write')
  checkPasted(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxPastedCheckSchema)) body: SampbidxPastedCheckInput) {
    return this.sampbidx.checkPasted(auth, body);
  }

  /** A file to send with pasted text, as the raw body (name in the query). Up to 20 MB. */
  @Post('attachments')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @RequirePermissions('activities:write')
  async attach(@Auth() auth: AuthContext, @Query('name') name: string | undefined, @Req() req: Request, @Meta() meta: RequestMeta) {
    if (!name?.trim()) throw new BadRequestException({ code: 'INVALID_NAME', message: 'Give the file a name.' });
    const data = await readEmailFile(req, SAMPBIDX_ATTACHMENT_MAX_BYTES, 'Attachments can be up to 20 MB each.');
    return this.sampbidx.uploadAttachment(auth, { name: name.trim(), contentType: String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase(), data }, meta);
  }

  @Delete('attachments/:id')
  @NoPasswordConfirmation('Removes a file you just added to an unsent RFQ email')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  async detach(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    await this.sampbidx.removeAttachment(auth, id);
  }

  /** Option 2c: the text of an RFQ email, pasted wherever the person works with the client. Also logs it as an interaction. */
  @Post('transfers/pasted-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions('activities:write')
  sendPasted(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxSendPastedEmailSchema)) body: SampbidxPastedEmail, @Meta() meta: RequestMeta) {
    return this.sampbidx.sendPastedEmail(auth, body, meta);
  }

  /** Option 2b: an .eml or .msg file, as the raw body (name and optional links in the query). */
  @Post('transfers/email-file')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions('activities:read')
  async sendFile(@Auth() auth: AuthContext, @Query(new ZodPipe(sampbidxEmailFileQuerySchema)) q: SampbidxEmailFileQuery, @Req() req: Request, @Meta() meta: RequestMeta) {
    const data = await readEmailFile(req);
    return this.sampbidx.sendEmailFile(auth, q, { name: q.name, contentType: String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase(), data }, meta);
  }

  @Get('transfers')
  @RequirePermissions('companies:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(sampbidxTransferListQuerySchema)) q: SampbidxTransferListQuery) {
    return this.sampbidx.list(auth, q);
  }

  @Post('transfers/:id/retry')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions('activities:read')
  retry(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.sampbidx.retry(auth, id, meta);
  }

  /** SampBidx's status updates, signed with X-SampBidx-Timestamp and X-SampBidx-Signature. */
  @Post('callbacks/:hookId')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  callback(@Param('hookId') hookId: string, @Req() req: RawBodyRequest<Request>, @Headers('x-sampbidx-timestamp') ts?: string, @Headers('x-sampbidx-signature') sig?: string) {
    return this.sampbidx.callback(hookId, req.rawBody, ts, sig);
  }
}
