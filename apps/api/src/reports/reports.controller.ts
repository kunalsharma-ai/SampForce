import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { dashboardInputSchema, immersiveQuerySchema, reportDefinitionSchema, reportInputSchema, z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ImmersiveService } from './immersive.service';
import { ReportsService } from './reports.service';

const uuid = new ParseUUIDPipe();
const runSchema = z.object({ definition: reportDefinitionSchema });

@Controller('reports')
@RequireFeature('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions('reports:read')
  list(@Auth() auth: AuthContext) {
    return this.reports.list(auth);
  }

  /** Runs an unsaved definition (the builder's live preview). */
  @Post('run')
  @HttpCode(200)
  @RequirePermissions('reports:read')
  run(@Auth() auth: AuthContext, @Body(new ZodPipe(runSchema)) body: z.infer<typeof runSchema>) {
    return this.reports.run(auth, body.definition);
  }

  @Post()
  @RequirePermissions('reports:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(reportInputSchema)) body: z.infer<typeof reportInputSchema>, @Meta() meta: RequestMeta) {
    return this.reports.create(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('reports:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.reports.get(auth, id);
  }

  @Get(':id/result')
  @RequirePermissions('reports:read')
  result(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.reports.runSaved(auth, id);
  }

  @Get(':id/export')
  @RequirePermissions('reports:read', 'data:export')
  async export(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response): Promise<string> {
    const { csv, name } = await this.reports.exportCsv(auth, id, meta);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="sampforce-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('cache-control', 'no-store');
    return csv;
  }

  @Put(':id')
  @RequirePermissions('reports:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(reportInputSchema)) body: z.infer<typeof reportInputSchema>, @Meta() meta: RequestMeta) {
    return this.reports.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('reports:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.reports.remove(auth, id, meta);
  }
}

@Controller('dashboards')
@RequireFeature('reports')
export class DashboardsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions('reports:read')
  list(@Auth() auth: AuthContext) {
    return this.reports.listDashboards(auth);
  }

  @Post()
  @RequirePermissions('reports:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(dashboardInputSchema)) body: z.infer<typeof dashboardInputSchema>, @Meta() meta: RequestMeta) {
    return this.reports.createDashboard(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('reports:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.reports.getDashboard(auth, id);
  }

  @Put(':id')
  @RequirePermissions('reports:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(dashboardInputSchema)) body: z.infer<typeof dashboardInputSchema>, @Meta() meta: RequestMeta) {
    return this.reports.updateDashboard(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('reports:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.reports.removeDashboard(auth, id, meta);
  }
}

@Controller('insights')
@RequireFeature('reports')
export class ImmersiveController {
  constructor(private readonly immersive: ImmersiveService) {}

  @Get('galaxy')
  @RequirePermissions('companies:read')
  galaxy(@Auth() auth: AuthContext) {
    return this.immersive.galaxy(auth);
  }

  @Get('globe')
  @RequirePermissions('companies:read', 'deals:read')
  globe(@Auth() auth: AuthContext) {
    return this.immersive.globe(auth);
  }

  @Get('flow')
  @RequirePermissions('deals:read', 'pipelines:read')
  flow(@Auth() auth: AuthContext, @Query(new ZodPipe(immersiveQuerySchema)) q: z.infer<typeof immersiveQuerySchema>) {
    return this.immersive.flow(auth, q.pipelineId, q.days);
  }

  @Get('replay')
  @RequirePermissions('deals:read', 'pipelines:read')
  replay(@Auth() auth: AuthContext, @Query(new ZodPipe(immersiveQuerySchema)) q: z.infer<typeof immersiveQuerySchema>) {
    return this.immersive.replay(auth, q.pipelineId, q.days);
  }
}
