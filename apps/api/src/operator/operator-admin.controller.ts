import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  emailSchema,
  type OperatorInviteInput,
  operatorInviteSchema,
  type OperatorRoleInput,
  operatorRoleInputSchema,
  type OperatorRoleUpdate,
  operatorRoleUpdateSchema,
  type OperatorSetPasswordInput,
  operatorSetPasswordSchema,
  type OperatorUpdateInput,
  operatorUpdateSchema,
  z,
} from '@dealflow/types';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { OperatorAdminService } from './operator-admin.service';
import { Operator, type OperatorContext, OperatorGuard, OperatorPermission, OperatorPublic, OperatorTokens } from './operator-auth';

const ip = (req: Request) => req.ip ?? null;
const roleId = z.string().trim().min(1).max(64);

/** Operators, roles and password links of the Console (ADR 0074). `@Public()` only skips the workspace guard. */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class OperatorAdminController {
  constructor(
    private readonly admin: OperatorAdminService,
    private readonly tokens: OperatorTokens,
  ) {}

  @Get('operators')
  @OperatorPermission('operators.manage')
  operators() {
    return this.admin.list();
  }

  @Post('operators')
  @OperatorPermission('operators.manage')
  invite(@Operator() op: OperatorContext, @Body(new ZodPipe(operatorInviteSchema)) body: OperatorInviteInput, @Req() req: Request) {
    return this.admin.invite(op, body, ip(req));
  }

  @Patch('operators/:id')
  @OperatorPermission('operators.manage')
  update(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(operatorUpdateSchema)) body: OperatorUpdateInput, @Req() req: Request) {
    return this.admin.update(op, id, body, ip(req));
  }

  /** A new link: an invitation for someone who has not joined yet, otherwise a password reset. */
  @Post('operators/:id/link')
  @OperatorPermission('operators.manage')
  @HttpCode(200)
  link(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.admin.resetLink(op, id, ip(req));
  }

  @Get('roles')
  @OperatorPermission('operators.manage')
  roles() {
    return this.admin.roles();
  }

  @Post('roles')
  @OperatorPermission('operators.manage')
  createRole(@Operator() op: OperatorContext, @Body(new ZodPipe(operatorRoleInputSchema)) body: OperatorRoleInput, @Req() req: Request) {
    return this.admin.createRole(op, body, ip(req));
  }

  @Patch('roles/:id')
  @OperatorPermission('operators.manage')
  updateRole(@Operator() op: OperatorContext, @Param('id', new ZodPipe(roleId)) id: string, @Body(new ZodPipe(operatorRoleUpdateSchema)) body: OperatorRoleUpdate, @Req() req: Request) {
    return this.admin.updateRole(op, id, body, ip(req));
  }

  @Delete('roles/:id')
  @OperatorPermission('operators.manage')
  @HttpCode(204)
  deleteRole(@Operator() op: OperatorContext, @Param('id', new ZodPipe(roleId)) id: string, @Req() req: Request) {
    return this.admin.deleteRole(op, id, ip(req));
  }

  // ───── Choosing a password from a link (signed out) ─────

  @Post('password/forgot')
  @OperatorPublic()
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgot(@Body(new ZodPipe(z.object({ email: emailSchema }).strict())) body: { email: string }, @Req() req: Request) {
    return this.admin.forgot(body.email, ip(req));
  }

  @Get('password/link')
  @OperatorPublic()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  linkInfo(@Query(new ZodPipe(z.object({ token: z.string().min(20).max(200) }).strict())) q: { token: string }) {
    return this.admin.tokenInfo(q.token);
  }

  /** Sets the password and signs the operator in. Links are 256-bit and single-use, so the limit only stops floods. */
  @Post('password')
  @OperatorPublic()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async setPassword(@Body(new ZodPipe(operatorSetPasswordSchema)) body: OperatorSetPasswordInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const op = await this.admin.setPassword(body.token, body.password, ip(req));
    this.tokens.cookie(res, await this.tokens.sign(op.id));
    return op;
  }
}
