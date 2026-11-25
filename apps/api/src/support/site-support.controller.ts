import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { operatorSiteSupportQuerySchema, operatorSiteSupportUpdateSchema, siteSupportRequestSchema } from '@dealflow/types';
import type { Request } from 'express';
import type { z } from 'zod';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { Operator, type OperatorContext, OperatorGuard, OperatorPermission } from '../operator/operator-auth';
import { SiteSupportService } from './site-support.service';

/** Per address, a few messages every ten minutes: enough for a person, too few to flood the Console. */
const SITE_SUPPORT_LIMIT = { default: { limit: Number(process.env.SITE_SUPPORT_RATE_LIMIT ?? 5), ttl: 600_000 } };

/** Help & Support on the public website (ADR 0078): anyone, signed in or not, can send SampForce a message. */
@Public()
@Controller('site/support-requests')
export class SiteSupportController {
  constructor(private readonly support: SiteSupportService) {}

  @Post()
  @HttpCode(201)
  @Throttle(SITE_SUPPORT_LIMIT)
  create(@Body(new ZodPipe(siteSupportRequestSchema)) body: z.output<typeof siteSupportRequestSchema>) {
    return this.support.create(body);
  }
}

/** The Console's Website messages list, beside Support tickets. `@Public()` only skips the workspace guard. */
@Controller('operator/support/site-requests')
@Public()
@UseGuards(OperatorGuard)
@OperatorPermission('support.handle')
export class OperatorSiteSupportController {
  constructor(private readonly support: SiteSupportService) {}

  @Get()
  list(@Query(new ZodPipe(operatorSiteSupportQuerySchema)) q: z.output<typeof operatorSiteSupportQuerySchema>) {
    return this.support.list(q);
  }

  @Patch(':id')
  update(
    @Operator() op: OperatorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(operatorSiteSupportUpdateSchema)) body: z.output<typeof operatorSiteSupportUpdateSchema>,
    @Req() req: Request,
  ) {
    return this.support.setStatus(op, id, body.status, req.ip ?? null);
  }
}
