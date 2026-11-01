import { Controller, Get, Query } from '@nestjs/common';
import { type DashboardCharts, type DashboardFilter, dashboardFilterSchema, type DashboardSummary } from '@dealflow/types';
import { Auth, type AuthContext, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DashboardChartsService } from './dashboard-charts.service';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly chartsService: DashboardChartsService,
  ) {}

  /** KPIs. Optional filters: period (7d, 30d, 90d, 365d), ownerId (a member or "me") and pipelineId. */
  @Get('summary')
  @RequirePermissions('dashboard:read')
  summary(@Auth() auth: AuthContext, @Query(new ZodPipe(dashboardFilterSchema)) filter: DashboardFilter): Promise<DashboardSummary> {
    return this.dashboard.summary(auth, filter);
  }

  /** Chart series for the Command Center, with the same filters. */
  @Get('charts')
  @RequirePermissions('dashboard:read')
  charts(@Auth() auth: AuthContext, @Query(new ZodPipe(dashboardFilterSchema)) filter: DashboardFilter): Promise<DashboardCharts> {
    return this.chartsService.charts(auth, filter);
  }
}
