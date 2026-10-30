import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { type OperatorPlanInput, operatorLoginSchema, operatorPlanSchema, operatorStatusSchema, z } from '@dealflow/types';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { Operator, type OperatorContext, OperatorGuard, OperatorPublic, OperatorRoles, OperatorTokens } from './operator-auth';
import { OperatorService } from './operator.service';

const ip = (req: Request) => req.ip ?? null;

/** `@Public()` only skips the workspace guard; every route here is protected by OperatorGuard instead. */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class OperatorController {
  constructor(
    private readonly ops: OperatorService,
    private readonly tokens: OperatorTokens,
  ) {}

  @Post('login')
  @OperatorPublic()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body(new ZodPipe(operatorLoginSchema)) body: z.infer<typeof operatorLoginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const op = await this.ops.login(body.email, body.password, ip(req));
    this.tokens.cookie(res, await this.tokens.sign(op.id));
    return op;
  }

  @Post('logout')
  @OperatorPublic()
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    this.tokens.cookie(res, null);
  }

  @Get('me')
  me(@Operator() op: OperatorContext) {
    return op;
  }

  @Get('tenants')
  tenants(@Operator() op: OperatorContext, @Query(new ZodPipe(z.object({ search: z.string().trim().max(100).optional() }))) q: { search?: string }, @Req() req: Request) {
    return this.ops.tenants(op, q, ip(req));
  }

  @Get('tenants/:id')
  tenant(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.ops.tenant(op, id, ip(req));
  }

  @Post('tenants/:id/plan')
  @HttpCode(200)
  @OperatorRoles('ADMIN')
  plan(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(operatorPlanSchema)) body: OperatorPlanInput, @Req() req: Request) {
    return this.ops.setPlan(op, id, body, ip(req));
  }

  @Post('tenants/:id/status')
  @HttpCode(200)
  @OperatorRoles('ADMIN')
  status(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(operatorStatusSchema)) body: z.infer<typeof operatorStatusSchema>, @Req() req: Request) {
    return this.ops.setSuspended(op, id, body.suspended, body.reason, ip(req));
  }

  @Get('audit-log')
  auditLog(@Query(new ZodPipe(z.object({ tenantId: z.string().uuid().optional() }))) q: { tenantId?: string }) {
    return this.ops.auditLog(q);
  }
}
