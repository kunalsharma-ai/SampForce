import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  type PipCreateInput,
  pipCommentSchema,
  pipCreateSchema,
  type PipDecisionInput,
  pipDecisionSchema,
  pipEvaluationSchema,
  pipReviewSchema,
  type PipUpdateInput,
  pipUpdateSchema,
  type RecognitionAwardInput,
  recognitionAwardSchema,
  type RecognitionPolicy,
  recognitionPolicySchema,
  recognitionRevokeSchema,
  recognitionSelectSchema,
  type RecognitionTargetCreateInput,
  recognitionTargetCreateSchema,
  type RecognitionTargetUpdateInput,
  recognitionTargetUpdateSchema,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { renderCertificatePdf } from './certificate';
import { PipsService } from './pips.service';
import { RecognitionService } from './recognition.service';

/**
 * Employee of the Month (ADR 0102). Who may do what follows the workspace hierarchy and the Super Workspace's policy;
 * the service checks it on every call, so the screens only mirror it.
 */
@Controller('recognition')
export class RecognitionController {
  constructor(private readonly recognition: RecognitionService) {}

  /** The dashboard card: the caller's own target and the month's winners. */
  @Get('me')
  card(@Auth() auth: AuthContext) {
    return this.recognition.card(auth);
  }

  @Get()
  view(@Auth() auth: AuthContext, @Query('month') month?: string) {
    return this.recognition.view(auth, month);
  }

  @Post('targets')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(recognitionTargetCreateSchema)) body: RecognitionTargetCreateInput, @Meta() meta: RequestMeta) {
    return this.recognition.create(auth, body as RecognitionTargetCreateInput & { goals: NonNullable<RecognitionTargetCreateInput['goals']> }, meta);
  }

  @Patch('targets/:id')
  update(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(recognitionTargetUpdateSchema)) body: RecognitionTargetUpdateInput, @Meta() meta: RequestMeta) {
    return this.recognition.update(auth, id, body, meta);
  }

  /** Cancels a target; it stays in the history. */
  @Post('targets/:id/cancel')
  @HttpCode(204)
  cancel(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.recognition.cancel(auth, id, meta);
  }

  /** Names the winner: the Super Workspace for the organisation, a manager for its team. */
  @Post('awards')
  award(@Auth() auth: AuthContext, @Body(new ZodPipe(recognitionAwardSchema)) body: RecognitionAwardInput, @Meta() meta: RequestMeta) {
    return this.recognition.award(auth, body, meta);
  }

  /** Runs the automatic selection for a month now (Super Workspace). */
  @Post('select')
  @HttpCode(200)
  select(@Auth() auth: AuthContext, @Body(new ZodPipe(recognitionSelectSchema)) body: { month: string }, @Meta() meta: RequestMeta) {
    return this.recognition.select(auth, body.month, meta);
  }

  @Post('awards/:id/revoke')
  @HttpCode(204)
  revoke(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(recognitionRevokeSchema)) body: { reason: string }, @Meta() meta: RequestMeta) {
    return this.recognition.revoke(auth, id, body.reason, meta);
  }

  @Get('awards/:id/certificate')
  async certificate(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    const { award, orgName } = await this.recognition.certificateData(auth, id);
    const pdf = await renderCertificatePdf(award, orgName);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="employee-of-the-month-${award.month}.pdf"`);
    res.send(pdf);
  }

  @Get('policy')
  policy(@Auth() auth: AuthContext) {
    return this.recognition.policy(auth);
  }

  @Put('policy')
  savePolicy(@Auth() auth: AuthContext, @Body(new ZodPipe(recognitionPolicySchema)) body: RecognitionPolicy, @Meta() meta: RequestMeta) {
    return this.recognition.savePolicy(auth, body, meta);
  }
}

const acknowledgeSchema = z.object({ comment: z.string().trim().max(2000).optional() }).strict();

/** Performance Improvement Plans (ADR 0102). */
@Controller('pips')
export class PipsController {
  constructor(private readonly pips: PipsService) {}

  /** The dashboard card: the caller's open plan, if any. */
  @Get('me')
  card(@Auth() auth: AuthContext) {
    return this.pips.card(auth);
  }

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.pips.list(auth);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.pips.get(auth, id);
  }

  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(pipCreateSchema)) body: PipCreateInput, @Meta() meta: RequestMeta) {
    return this.pips.create(auth, body as PipCreateInput & { goals: NonNullable<PipCreateInput['goals']> }, meta);
  }

  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(pipUpdateSchema)) body: PipUpdateInput, @Meta() meta: RequestMeta) {
    return this.pips.update(auth, id, body, meta);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.pips.activate(auth, id, meta);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  acknowledge(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(acknowledgeSchema)) body: { comment?: string }, @Meta() meta: RequestMeta) {
    return this.pips.acknowledge(auth, id, body.comment, meta);
  }

  @Post(':id/comments')
  @HttpCode(200)
  comment(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(pipCommentSchema)) body: { body: string; documents?: { name: string; url: string }[] }, @Meta() meta: RequestMeta) {
    return this.pips.comment(auth, id, body.body, body.documents, meta);
  }

  @Post(':id/evaluations')
  @HttpCode(200)
  evaluate(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(pipEvaluationSchema)) body: { goalId: string; score: number; comments: string }, @Meta() meta: RequestMeta) {
    return this.pips.evaluateGoal(auth, id, body, meta);
  }

  @Post(':id/reviews')
  @HttpCode(200)
  review(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(pipReviewSchema)) body: { notes: string; nextReviewOn?: string }, @Meta() meta: RequestMeta) {
    return this.pips.review(auth, id, body, meta);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(pipDecisionSchema)) body: PipDecisionInput, @Meta() meta: RequestMeta) {
    return this.pips.decide(auth, id, body, meta);
  }

  @Post(':id/dismiss')
  @HttpCode(204)
  dismiss(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.pips.dismissCompletion(auth, id);
  }
}
