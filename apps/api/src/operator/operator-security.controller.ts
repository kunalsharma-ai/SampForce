import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  type ConsoleSecurityPolicyUpdate,
  consoleSecurityPolicyUpdateSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaRegenerateSchema,
  mfaSetupSchema,
  operatorLoginQuerySchema,
  operatorLoginSchema,
  operatorMfaLoginSchema,
  z,
} from '@dealflow/types';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { OPERATOR_COOKIE, Operator, OperatorAny, type OperatorContext, OperatorGuard, OperatorPermission, OperatorPublic, OperatorTokens } from './operator-auth';
import { OperatorSecurityService, type SignInMeta, type SignInStep } from './operator-security.service';

const ip = (req: Request) => req.ip ?? null;
/** Sign-in and password links: the same per-address limit as workspace sign-in (10 a minute unless configured). */
const AUTH_LIMIT = { default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };
const meta = (req: Request): SignInMeta => ({ ip: ip(req), userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null });

/**
 * Console sign-in security (ADR 0074): password and second step, sign-out, the operator's own two-step verification,
 * sessions and sign-ins, and for Super Admins the policy, everyone's sessions and the login history.
 */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class OperatorSecurityController {
  constructor(
    private readonly security: OperatorSecurityService,
    private readonly tokens: OperatorTokens,
  ) {}

  private async answer(step: SignInStep, res: Response) {
    if (step.kind === 'challenge') return { mfaRequired: true as const, challenge: step.challenge };
    this.tokens.cookie(res, await this.tokens.sign(step.operator.id, step.sessionId, step.seconds), step.seconds);
    return { ...step.operator, mfaSetupRequired: step.mfaSetupRequired };
  }

  @Post('login')
  @OperatorPublic()
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  async login(@Body(new ZodPipe(operatorLoginSchema)) body: z.infer<typeof operatorLoginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const step = await this.security.login(body.email, body.password, !!body.remember, meta(req), { challenge: (id) => this.tokens.signChallenge(id) });
    return this.answer(step, res);
  }

  @Post('login/mfa')
  @OperatorPublic()
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  async loginMfa(@Body(new ZodPipe(operatorMfaLoginSchema)) body: z.infer<typeof operatorMfaLoginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const id = await this.tokens.verifyChallenge(body.challenge);
    return this.answer(await this.security.loginMfa(id, body.code, !!body.remember, meta(req)), res);
  }

  /** Ends this browser's session on the server too, so a copied cookie stops working. */
  @Post('logout')
  @OperatorPublic()
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[OPERATOR_COOKIE];
    const claims = raw ? await this.tokens.verify(raw) : null;
    await this.security.logout(claims?.sid);
    this.tokens.cookie(res, null);
  }

  // ───── The operator's own account ─────

  @Get('me/mfa')
  @OperatorAny()
  mfa(@Operator() op: OperatorContext) {
    return this.security.mfaStatus(op.id);
  }

  @Post('me/mfa/setup')
  @OperatorAny()
  @HttpCode(200)
  mfaSetup(@Operator() op: OperatorContext, @Body(new ZodPipe(mfaSetupSchema)) body: { password: string }, @Req() req: Request) {
    return this.security.mfaSetup(op.id, body.password, ip(req));
  }

  @Post('me/mfa/enable')
  @OperatorAny()
  @HttpCode(200)
  mfaEnable(@Operator() op: OperatorContext, @Body(new ZodPipe(mfaEnableSchema)) body: { code: string }, @Req() req: Request) {
    return this.security.mfaEnable(op, body.code, ip(req));
  }

  @Post('me/mfa/disable')
  @OperatorAny()
  @HttpCode(204)
  mfaDisable(@Operator() op: OperatorContext, @Body(new ZodPipe(mfaDisableSchema)) body: { password: string; code: string }, @Req() req: Request) {
    return this.security.mfaDisable(op, body.password, body.code, ip(req));
  }

  @Post('me/mfa/recovery-codes')
  @OperatorAny()
  @HttpCode(200)
  recoveryCodes(@Operator() op: OperatorContext, @Body(new ZodPipe(mfaRegenerateSchema)) body: { code: string }, @Req() req: Request) {
    return this.security.regenerateCodes(op, body.code, ip(req));
  }

  @Get('me/sessions')
  @OperatorAny()
  mySessions(@Operator() op: OperatorContext) {
    return this.security.mySessions(op);
  }

  /** Ends one of the operator's own sessions; with security.manage, anyone's. */
  @Delete('me/sessions/:id')
  @OperatorAny()
  @HttpCode(204)
  endSession(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.security.endSession(op, id, ip(req));
  }

  @Post('me/sessions/end-others')
  @OperatorAny()
  @HttpCode(200)
  endOthers(@Operator() op: OperatorContext, @Req() req: Request) {
    return this.security.endOtherSessions(op, ip(req));
  }

  @Get('me/logins')
  @OperatorAny()
  myLogins(@Operator() op: OperatorContext) {
    return this.security.logins({ operatorId: op.id }, 30);
  }

  // ───── Platform security (Super Admins) ─────

  @Get('security/policy')
  @OperatorPermission('security.manage')
  policy() {
    return this.security.policy();
  }

  @Put('security/policy')
  @OperatorPermission('security.manage')
  setPolicy(@Operator() op: OperatorContext, @Body(new ZodPipe(consoleSecurityPolicyUpdateSchema)) body: ConsoleSecurityPolicyUpdate, @Req() req: Request) {
    return this.security.setPolicy(op, body, ip(req));
  }

  @Get('security/sessions')
  @OperatorPermission('security.manage')
  sessions(@Operator() op: OperatorContext) {
    return this.security.allSessions(op);
  }

  @Get('security/logins')
  @OperatorPermission('security.manage')
  logins(@Query(new ZodPipe(operatorLoginQuerySchema)) q: z.infer<typeof operatorLoginQuerySchema>) {
    return this.security.logins(q.suspicious ? { suspicious: q.suspicious === 'true' } : {}, q.limit);
  }

  @Post('operators/:id/sessions/end')
  @OperatorPermission('security.manage')
  @HttpCode(200)
  endOperatorSessions(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.security.endOperatorSessions(op, id, ip(req));
  }

  @Post('operators/:id/mfa/reset')
  @OperatorPermission('security.manage')
  @HttpCode(204)
  resetMfa(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.security.resetMfa(op, id, ip(req));
  }
}
