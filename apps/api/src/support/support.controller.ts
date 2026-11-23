import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  operatorSupportQuerySchema,
  operatorSupportUpdateSchema,
  supportEscalateSchema,
  supportListQuerySchema,
  supportMessageSchema,
  supportReportQuerySchema,
  supportStatusSchema,
  supportTicketCreateSchema,
} from '@dealflow/types';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Auth, type AuthContext, Meta, MobileAccess, Public, type RequestMeta } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { Operator, type OperatorContext, OperatorGuard } from '../operator/operator-auth';
import { fileFrom, readUpload, sendFile } from '../portal/portal-documents';
import { SupportService } from './support.service';

const uuid = new ParseUUIDPipe();

/** Queries raised from Help ("Other: raise a query") by anyone in the workspace (ADR 0073). Phones use the same routes. */
@MobileAccess()
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  // Per address: an office of people behind one IP still fits.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(supportTicketCreateSchema)) body: z.output<typeof supportTicketCreateSchema>, @Meta() meta: RequestMeta) {
    return this.support.create(auth, body, meta);
  }

  @Get()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(supportListQuerySchema)) q: z.output<typeof supportListQuerySchema>) {
    return this.support.list(auth, q.scope, q.status);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.support.get(auth, id);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reply(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(supportMessageSchema)) body: z.output<typeof supportMessageSchema>, @Meta() meta: RequestMeta) {
    return this.support.reply(auth, id, body, meta);
  }

  @Patch(':id')
  status(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(supportStatusSchema)) body: z.output<typeof supportStatusSchema>, @Meta() meta: RequestMeta) {
    return this.support.setStatus(auth, id, body, meta);
  }

  /** The workspace handling the ticket passes it one level up (ADR 0071 part 5). */
  @Post(':id/escalate')
  @HttpCode(200)
  escalate(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(supportEscalateSchema)) body: z.output<typeof supportEscalateSchema>, @Meta() meta: RequestMeta) {
    return this.support.escalate(auth, id, body.note, meta);
  }
}

/** Screenshots and files for a new query or a reply: uploaded as the raw body, then sent by id with the message. Phones too. */
@MobileAccess()
@Controller('support/attachments')
export class SupportAttachmentsController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async upload(@Auth() auth: AuthContext, @Query('name') name: string | undefined, @Req() req: Request) {
    return this.support.upload(auth, fileFrom(req, name, await readUpload(req)));
  }

  @Get(':id/download')
  async download(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.support.download(auth, id));
  }
}

/**
 * The Console's Support tickets inbox: every operator reads and answers every client's tickets, as with the support
 * chat. `@Public()` only skips the workspace guard; OperatorGuard protects every route.
 */
@Controller('operator/support/tickets')
@Public()
@UseGuards(OperatorGuard)
export class OperatorSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Operator() op: OperatorContext, @Query(new ZodPipe(operatorSupportQuerySchema)) q: z.output<typeof operatorSupportQuerySchema>) {
    return this.support.operatorList(op, q);
  }

  @Get('counts')
  counts(@Operator() op: OperatorContext) {
    return this.support.operatorCounts(op);
  }

  /** Support reports for the period: volume, topics, clients, who handles them and how fast. */
  @Get('report')
  report(@Query(new ZodPipe(supportReportQuerySchema)) q: z.output<typeof supportReportQuerySchema>) {
    return this.support.operatorReport(q.days);
  }

  /** The operators a ticket can be assigned to. */
  @Get('representatives')
  representatives() {
    return this.support.representatives();
  }

  @Get(':id')
  get(@Operator() op: OperatorContext, @Param('id', uuid) id: string) {
    return this.support.operatorGet(op, id);
  }

  @Post(':id/messages')
  @HttpCode(201)
  reply(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Body(new ZodPipe(supportMessageSchema)) body: z.output<typeof supportMessageSchema>, @Req() req: Request) {
    return this.support.operatorReply(op, id, body, req.ip ?? null);
  }

  @Post(':id/attachments')
  async upload(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Query('name') name: string | undefined, @Req() req: Request) {
    return this.support.operatorUpload(op, id, fileFrom(req, name, await readUpload(req)));
  }

  @Get(':id/attachments/:fileId/download')
  async download(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Param('fileId', uuid) fileId: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.support.operatorDownload(op, id, fileId));
  }

  @Patch(':id')
  update(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Body(new ZodPipe(operatorSupportUpdateSchema)) body: z.output<typeof operatorSupportUpdateSchema>, @Req() req: Request) {
    return this.support.operatorUpdate(op, id, body, req.ip ?? null);
  }
}
