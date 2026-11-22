import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  operatorSupportQuerySchema,
  supportListQuerySchema,
  supportMessageSchema,
  supportStatusSchema,
  supportTicketCreateSchema,
} from '@dealflow/types';
import type { Request } from 'express';
import type { z } from 'zod';
import { Auth, type AuthContext, Meta, Public, type RequestMeta } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { Operator, type OperatorContext, OperatorGuard } from '../operator/operator-auth';
import { SupportService } from './support.service';

const uuid = new ParseUUIDPipe();

/** Queries raised from Help ("Other: raise a query") by anyone in the workspace (ADR 0073). */
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
    return this.support.reply(auth, id, body.body, meta);
  }

  @Patch(':id')
  status(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(supportStatusSchema)) body: z.output<typeof supportStatusSchema>, @Meta() meta: RequestMeta) {
    return this.support.setStatus(auth, id, body.status, meta);
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

  @Get(':id')
  get(@Operator() op: OperatorContext, @Param('id', uuid) id: string) {
    return this.support.operatorGet(op, id);
  }

  @Post(':id/messages')
  @HttpCode(201)
  reply(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Body(new ZodPipe(supportMessageSchema)) body: z.output<typeof supportMessageSchema>, @Req() req: Request) {
    return this.support.operatorReply(op, id, body.body, req.ip ?? null);
  }

  @Patch(':id')
  status(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Body(new ZodPipe(supportStatusSchema)) body: z.output<typeof supportStatusSchema>, @Req() req: Request) {
    return this.support.operatorSetStatus(op, id, body.status, req.ip ?? null);
  }
}
