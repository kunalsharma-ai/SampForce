import { Body, Controller, Get, HttpCode, Param, ParseEnumPipe, Put, Query } from '@nestjs/common';
import {
  type CommandCenterLayout,
  commandCenterLayoutSchema,
  type CommandCenterQuery,
  commandCenterQuerySchema,
  DASHBOARD_TIERS,
  type DashboardTier,
  type DrillQuery,
  drillQuerySchema,
  salesTargetInputSchema,
  type SeniorQuery,
  seniorQuerySchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { CommandCenterService } from './command-center.service';
import { ManagerDashboardService } from './manager.service';
import { SeniorDashboardService } from './senior.service';

const tierPipe = new ParseEnumPipe(Object.fromEntries(DASHBOARD_TIERS.map((t) => [t, t])));
const layoutBody = z.object({ layout: commandCenterLayoutSchema.nullable() });

/** The role-based Command Center (ADR 0063). */
@Controller('command-center')
export class CommandCenterController {
  constructor(
    private readonly cc: CommandCenterService,
    private readonly manager: ManagerDashboardService,
    private readonly senior: SeniorDashboardService,
  ) {}

  /** The caller's tier, the dashboards they can open, and the people who report to them. */
  @Get('context')
  @RequirePermissions('dashboard:read')
  context(@Auth() auth: AuthContext) {
    return this.cc.context(auth);
  }

  /** One person's Executive dashboard: the caller's, or (userId) someone their record visibility reaches. */
  @Get('executive')
  @RequirePermissions('dashboard:read')
  executive(@Auth() auth: AuthContext, @Query(new ZodPipe(commandCenterQuerySchema)) q: CommandCenterQuery) {
    return this.cc.executive(auth, q);
  }

  /** A manager's team dashboard: the caller's, or (userId) that of a manager their record visibility reaches. */
  @Get('manager')
  @RequirePermissions('dashboard:read')
  managerDashboard(@Auth() auth: AuthContext, @Query(new ZodPipe(commandCenterQuerySchema)) q: CommandCenterQuery) {
    return this.manager.dashboard(auth, q);
  }

  /** The organisation (or the part the caller's visibility reaches, or one department) for senior management. */
  @Get('senior')
  @RequirePermissions('dashboard:read')
  seniorDashboard(@Auth() auth: AuthContext, @Query(new ZodPipe(seniorQuerySchema)) q: SeniorQuery) {
    return this.senior.dashboard(auth, q);
  }

  /** The records behind one number of a dashboard. */
  @Get('drill')
  @RequirePermissions('dashboard:read')
  drill(@Auth() auth: AuthContext, @Query(new ZodPipe(drillQuerySchema)) q: DrillQuery) {
    return this.cc.drill(auth, q);
  }

  @Get('layout/:tier')
  @RequirePermissions('dashboard:read')
  layout(@Auth() auth: AuthContext, @Param('tier', tierPipe) tier: DashboardTier) {
    return this.cc.layout(auth, tier).then((layout) => ({ layout }));
  }

  /** The caller's order and hidden sections of one dashboard (null resets it). */
  @Put('layout/:tier')
  @RequirePermissions('dashboard:read')
  saveLayout(@Auth() auth: AuthContext, @Param('tier', tierPipe) tier: DashboardTier, @Body(new ZodPipe(layoutBody)) body: { layout: CommandCenterLayout | null }) {
    return this.cc.saveLayout(auth, tier, body.layout).then((layout) => ({ layout }));
  }

  /** A monthly, quarterly or yearly target for a person the caller manages, or for the workspace. */
  @Put('targets')
  @HttpCode(200)
  @RequirePermissions('pipelines:manage')
  setTarget(@Auth() auth: AuthContext, @Body(new ZodPipe(salesTargetInputSchema)) body: z.infer<typeof salesTargetInputSchema>, @Meta() meta: RequestMeta) {
    return this.cc.setTarget(auth, body, meta);
  }
}
