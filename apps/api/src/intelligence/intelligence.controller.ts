import { Body, Controller, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  dealHealthQuerySchema,
  insightQuerySchema,
  nextActionAcceptSchema,
  nextActionDismissSchema,
  TIMELINE_ENTITIES,
  type TimelineEntity,
  timelineQuerySchema,
  type z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DealHealthService } from './deal-health.service';
import { InsightsService } from './insights.service';
import { NextActionsService } from './next-actions.service';
import { TimelineService } from './timeline.service';

const uuid = new ParseUUIDPipe();

/** Enhancement Phase 1: sales intelligence over existing CRM data. */
@Controller()
export class IntelligenceController {
  constructor(
    private readonly health: DealHealthService,
    private readonly nextActions: NextActionsService,
    private readonly timeline: TimelineService,
    private readonly insights: InsightsService,
  ) {}

  @Get('deal-health')
  @RequirePermissions('deals:read')
  dealHealthList(@Auth() auth: AuthContext, @Query(new ZodPipe(dealHealthQuerySchema)) q: z.infer<typeof dealHealthQuerySchema>) {
    return this.health.list(auth, q);
  }

  @Get('deal-health/summary')
  @RequirePermissions('deals:read')
  dealHealthSummary(@Auth() auth: AuthContext) {
    return this.health.summary(auth);
  }

  @Post('deal-health/refresh')
  @HttpCode(200)
  @RequirePermissions('deals:read')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  dealHealthRefresh(@Auth() auth: AuthContext) {
    return this.health.refreshNow(auth);
  }

  @Get('deals/:id/health')
  @RequirePermissions('deals:read')
  dealHealthDetail(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.health.detail(auth, id);
  }

  @Get('next-actions')
  @RequirePermissions('dashboard:read')
  nextActionList(@Auth() auth: AuthContext) {
    return this.nextActions.list(auth);
  }

  @Post('next-actions/dismiss')
  @HttpCode(200)
  @RequirePermissions('dashboard:read')
  dismiss(@Auth() auth: AuthContext, @Body(new ZodPipe(nextActionDismissSchema)) body: z.infer<typeof nextActionDismissSchema>) {
    return this.nextActions.dismiss(auth, body);
  }

  @Post('next-actions/accept')
  @HttpCode(200)
  @RequirePermissions('dashboard:read', 'activities:write')
  accept(@Auth() auth: AuthContext, @Body(new ZodPipe(nextActionAcceptSchema)) body: z.infer<typeof nextActionAcceptSchema>, @Meta() meta: RequestMeta) {
    return this.nextActions.accept(auth, body, meta);
  }

  @Get('timeline/:entity/:id')
  @RequirePermissions('dashboard:read')
  getTimeline(
    @Auth() auth: AuthContext,
    @Param('entity', new ParseEnumPipe(TIMELINE_ENTITIES)) entity: TimelineEntity,
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(timelineQuerySchema)) q: z.infer<typeof timelineQuerySchema>,
  ) {
    return this.timeline.get(auth, entity, id, q);
  }

  @Get('insights')
  @RequirePermissions('dashboard:read')
  feed(@Auth() auth: AuthContext, @Query(new ZodPipe(insightQuerySchema)) q: z.infer<typeof insightQuerySchema>) {
    return this.insights.feed(auth, q.scope);
  }
}
