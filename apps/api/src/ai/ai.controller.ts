import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  acceptNextStepSchema,
  actionDecisionSchema,
  aiSettingsUpdateSchema,
  type AiSettingsUpdate,
  copilotRequestSchema,
  type CopilotRequest,
  createActionItemsSchema,
  emailAnalyseRequestSchema,
  emailDraftRequestSchema,
  type EmailDraftRequest,
  emailRewriteRequestSchema,
  type EmailRewriteRequest,
  emailSubjectsRequestSchema,
  forecastQuerySchema,
  forecastSettingsSchema,
  type ForecastSettingsInput,
  meetingNotesRequestSchema,
  type MeetingNotesRequest,
  snapshotInputSchema,
  workflowDraftRequestSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AgentsService } from './agents.service';
import { AiService } from './ai.service';
import { CopilotService } from './copilot.service';
import { EmailAssistantService } from './email-assistant.service';
import { ForecastPlanService } from './forecast-plan.service';
import { ForecastService } from './forecast.service';

const uuid = new ParseUUIDPipe();
const recQuery = z.object({ entityType: z.enum(['lead', 'contact', 'deal']), entityId: z.string().uuid() });
const compareQuery = z.object({ from: z.string().uuid(), to: z.string().uuid() });

/** AI governance, Copilot and agents. Every route needs `ai:use`; agents also check the permission of the work they do. */
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly copilot: CopilotService,
    private readonly agents: AgentsService,
    private readonly email: EmailAssistantService,
  ) {}

  // Email Assistant: results go into an editor; nothing here sends email.
  @Post('email/draft')
  @HttpCode(200)
  @RequirePermissions('ai:use')
  emailDraft(@Auth() auth: AuthContext, @Body(new ZodPipe(emailDraftRequestSchema)) body: EmailDraftRequest, @Meta() meta: RequestMeta) {
    return this.email.draft(auth, body, meta);
  }

  @Post('email/rewrite')
  @HttpCode(200)
  @RequirePermissions('ai:use')
  emailRewrite(@Auth() auth: AuthContext, @Body(new ZodPipe(emailRewriteRequestSchema)) body: EmailRewriteRequest) {
    return this.email.rewrite(auth, body);
  }

  @Post('email/subjects')
  @HttpCode(200)
  @RequirePermissions('ai:use')
  emailSubjects(@Auth() auth: AuthContext, @Body(new ZodPipe(emailSubjectsRequestSchema)) body: z.infer<typeof emailSubjectsRequestSchema>) {
    return this.email.subjects(auth, body.body, body.current);
  }

  @Post('email/analyse')
  @HttpCode(200)
  @RequirePermissions('ai:use', 'activities:read')
  emailAnalyse(@Auth() auth: AuthContext, @Body(new ZodPipe(emailAnalyseRequestSchema)) body: z.infer<typeof emailAnalyseRequestSchema>, @Meta() meta: RequestMeta) {
    return this.email.analyse(auth, body.emailId, meta);
  }

  @Get('email/analysis/:emailId')
  @RequirePermissions('ai:use', 'activities:read')
  emailAnalysis(@Auth() auth: AuthContext, @Param('emailId', uuid) emailId: string) {
    return this.email.latestAnalysis(auth, emailId).then((analysis) => ({ analysis }));
  }

  @Get('status')
  @RequirePermissions('ai:use')
  status(@Auth() auth: AuthContext) {
    return this.ai.status(auth);
  }

  @Patch('settings')
  @RequirePermissions('ai:manage')
  settings(@Auth() auth: AuthContext, @Body(new ZodPipe(aiSettingsUpdateSchema)) body: AiSettingsUpdate, @Meta() meta: RequestMeta) {
    return this.ai.updateSettings(auth, body, meta);
  }

  @Get('usage')
  @RequirePermissions('ai:manage')
  usage(@Auth() auth: AuthContext) {
    return this.ai.usage(auth);
  }

  @Get('runs/:id')
  @RequirePermissions('ai:manage')
  run(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.ai.run(auth, id);
  }

  @Post('copilot')
  @HttpCode(200)
  @RequirePermissions('ai:use')
  ask(@Auth() auth: AuthContext, @Body(new ZodPipe(copilotRequestSchema)) body: CopilotRequest, @Meta() meta: RequestMeta) {
    return this.copilot.ask(auth, body, meta);
  }

  @Get('copilot/conversations/:id')
  @RequirePermissions('ai:use')
  conversation(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.copilot.conversation(auth, id);
  }

  @Post('copilot/runs/:runId/actions/:actionId')
  @HttpCode(200)
  @RequirePermissions('ai:use')
  decide(
    @Auth() auth: AuthContext,
    @Param('runId', uuid) runId: string,
    @Param('actionId', uuid) actionId: string,
    @Body(new ZodPipe(actionDecisionSchema)) body: z.infer<typeof actionDecisionSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.copilot.decide(auth, runId, actionId, body.decision, meta);
  }

  @Post('leads/:id/qualify')
  @HttpCode(200)
  @RequirePermissions('ai:use', 'leads:write')
  qualify(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.agents.qualifyLead(auth, id, { meta });
  }

  @Post('deals/:id/analyse')
  @HttpCode(200)
  @RequirePermissions('ai:use', 'deals:read')
  analyse(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.agents.analyseDeal(auth, id, meta);
  }

  @Post('deals/:id/proposal')
  @HttpCode(200)
  @RequirePermissions('ai:use', 'deals:read')
  proposal(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.agents.proposal(auth, id, meta);
  }

  @Post('meeting-notes')
  @HttpCode(200)
  @RequirePermissions('ai:use', 'activities:write')
  meetingNotes(@Auth() auth: AuthContext, @Body(new ZodPipe(meetingNotesRequestSchema)) body: MeetingNotesRequest, @Meta() meta: RequestMeta) {
    return this.agents.meetingNotes(auth, body, meta);
  }

  @Post('workflows/draft')
  @HttpCode(200)
  @RequirePermissions('ai:use', 'automation:manage')
  draftWorkflow(@Auth() auth: AuthContext, @Body(new ZodPipe(workflowDraftRequestSchema)) body: z.infer<typeof workflowDraftRequestSchema>) {
    return this.agents.draftWorkflow(auth, body.description);
  }

  @Get('recommendations')
  @RequirePermissions('ai:use')
  recommendations(@Auth() auth: AuthContext, @Query(new ZodPipe(recQuery)) q: z.infer<typeof recQuery>) {
    return this.agents.list(auth, q.entityType, q.entityId);
  }

  @Post('recommendations/:id/accept')
  @HttpCode(200)
  @RequirePermissions('ai:use')
  accept(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(acceptNextStepSchema)) body: z.infer<typeof acceptNextStepSchema>, @Meta() meta: RequestMeta) {
    return this.agents.accept(auth, id, body, meta);
  }

  @Post('recommendations/:id/dismiss')
  @HttpCode(200)
  @RequirePermissions('ai:use')
  dismiss(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.agents.dismiss(auth, id, meta);
  }

  @Post('recommendations/:id/tasks')
  @HttpCode(200)
  @RequirePermissions('ai:use', 'activities:write')
  actionItems(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(createActionItemsSchema)) body: z.infer<typeof createActionItemsSchema>, @Meta() meta: RequestMeta) {
    return this.agents.createActionItems(auth, id, body.indexes, meta);
  }

  @Post('forecast/explain')
  @HttpCode(200)
  @RequirePermissions('ai:use', 'dashboard:read', 'deals:read')
  explain(@Auth() auth: AuthContext, @Body(new ZodPipe(compareQuery)) body: z.infer<typeof compareQuery>) {
    return this.agents.explainForecast(auth, body.from, body.to);
  }
}

const trendsQuery = z.object({ granularity: z.enum(['month', 'quarter', 'year']).default('quarter'), count: z.coerce.number().int().min(2).max(24).default(8) });

/** Rule-based forecasting and snapshots. No AI is involved in any number here. */
@Controller('forecast')
export class ForecastController {
  constructor(
    private readonly forecast: ForecastService,
    private readonly plans: ForecastPlanService,
  ) {}

  @Get()
  @RequirePermissions('dashboard:read', 'deals:read')
  current(@Auth() auth: AuthContext, @Query(new ZodPipe(forecastQuerySchema)) q: z.infer<typeof forecastQuerySchema>) {
    return this.forecast.current(auth, q.period);
  }

  @Get('snapshots')
  @RequirePermissions('dashboard:read', 'deals:read')
  snapshots(@Auth() auth: AuthContext, @Query(new ZodPipe(forecastQuerySchema)) q: z.infer<typeof forecastQuerySchema>) {
    return this.forecast.list(auth, q.period);
  }

  @Post('snapshots')
  @RequirePermissions('dashboard:read', 'deals:read')
  snapshot(@Auth() auth: AuthContext, @Body(new ZodPipe(snapshotInputSchema)) body: z.infer<typeof snapshotInputSchema>, @Meta() meta: RequestMeta) {
    return this.forecast.snapshot(auth, body.period, body.label, meta);
  }

  @Get('snapshots/:id/verify')
  @RequirePermissions('dashboard:read', 'deals:read')
  verify(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.forecast.verify(auth, id);
  }

  @Get('plan')
  @RequirePermissions('dashboard:read', 'deals:read')
  plan(@Auth() auth: AuthContext, @Query(new ZodPipe(forecastQuerySchema)) q: z.infer<typeof forecastQuerySchema>) {
    return this.plans.plan(auth, q.period);
  }

  @Get('trends')
  @RequirePermissions('dashboard:read', 'deals:read')
  trends(@Auth() auth: AuthContext, @Query(new ZodPipe(trendsQuery)) q: z.infer<typeof trendsQuery>) {
    return this.plans.trends(auth, q.granularity, q.count);
  }

  @Get('settings')
  @RequirePermissions('dashboard:read', 'deals:read')
  settings(@Auth() auth: AuthContext) {
    return this.forecast.getSettings(auth);
  }

  /** Managers (the same permission that sets targets) choose how probabilities and categories are worked out. */
  @Put('settings')
  @RequirePermissions('pipelines:manage')
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(forecastSettingsSchema)) body: ForecastSettingsInput, @Meta() meta: RequestMeta) {
    return this.forecast.saveSettings(auth, body, meta);
  }

  @Get('compare')
  @RequirePermissions('dashboard:read', 'deals:read')
  compare(@Auth() auth: AuthContext, @Query(new ZodPipe(compareQuery)) q: z.infer<typeof compareQuery>) {
    return this.forecast.compare(auth, q.from, q.to);
  }
}
