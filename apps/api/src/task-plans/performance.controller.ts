import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { type PerformanceQuery, performanceQuerySchema, type PerformanceSettingsInput, performanceSettingsSchema } from '@dealflow/types';
import { Auth, type AuthContext, Meta, OwnHierarchyRules, type RequestMeta, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PerformanceService } from './performance.service';

/** Performance ranking (ADR 0096): plain arithmetic on stored records, measures and weights set by the Super Workspace. */
@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  @RequireFeature('sales_target_management')
  @OwnHierarchyRules()
  view(@Auth() auth: AuthContext, @Query(new ZodPipe(performanceQuerySchema)) q: PerformanceQuery) {
    return this.performance.view(auth, q);
  }

  @Get('settings')
  @RequireFeature('sales_target_management')
  @OwnHierarchyRules()
  settings(@Auth() auth: AuthContext) {
    return this.performance.settings(auth);
  }

  @Put('settings')
  @RequireFeature('sales_target_management')
  @OwnHierarchyRules()
  save(@Auth() auth: AuthContext, @Body(new ZodPipe(performanceSettingsSchema)) body: PerformanceSettingsInput, @Meta() meta: RequestMeta) {
    return this.performance.save(auth, body, meta);
  }
}
