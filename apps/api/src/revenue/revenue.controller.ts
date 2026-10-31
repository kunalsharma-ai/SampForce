import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { analyticsQuerySchema, escalationInputSchema, escalationResolveSchema, exchangeRateInputSchema, forecastQuerySchema, salesTargetInputSchema, z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AnalyticsService } from './analytics.service';
import { SuccessService } from './success.service';

const uuid = new ParseUUIDPipe();
const escalationQuery = z.object({ status: z.enum(['OPEN', 'RESOLVED']).optional(), companyId: z.string().uuid().optional() });

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('revenue')
  @RequirePermissions('dashboard:read', 'deals:read')
  revenue(@Auth() auth: AuthContext, @Query(new ZodPipe(analyticsQuerySchema)) q: z.infer<typeof analyticsQuerySchema>) {
    return this.analytics.revenue(auth, q.period);
  }

  @Get('exchange-rates')
  @RequirePermissions('dashboard:read')
  rates(@Auth() auth: AuthContext) {
    return this.analytics.rates(auth);
  }

  @Put('exchange-rates')
  @RequirePermissions('catalog:manage')
  setRate(@Auth() auth: AuthContext, @Body(new ZodPipe(exchangeRateInputSchema)) body: z.infer<typeof exchangeRateInputSchema>, @Meta() meta: RequestMeta) {
    return this.analytics.setRate(auth, body, meta);
  }

  @Get('targets')
  @RequirePermissions('dashboard:read')
  targets(@Auth() auth: AuthContext, @Query(new ZodPipe(forecastQuerySchema)) q: z.infer<typeof forecastQuerySchema>) {
    return this.analytics.targets(auth, q.period);
  }

  @Put('targets')
  @RequirePermissions('pipelines:manage')
  setTarget(@Auth() auth: AuthContext, @Body(new ZodPipe(salesTargetInputSchema)) body: z.infer<typeof salesTargetInputSchema>, @Meta() meta: RequestMeta) {
    return this.analytics.setTarget(auth, body, meta);
  }

  @Delete('targets/:id')
  @HttpCode(204)
  @RequirePermissions('pipelines:manage')
  removeTarget(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.analytics.removeTarget(auth, id, meta);
  }
}

@Controller('success')
export class SuccessController {
  constructor(private readonly success: SuccessService) {}

  @Get('customers')
  @RequirePermissions('success:read', 'companies:read')
  customers(@Auth() auth: AuthContext) {
    return this.success.customers(auth);
  }

  @Get('customers/:companyId')
  @RequirePermissions('success:read', 'companies:read')
  customer(@Auth() auth: AuthContext, @Param('companyId', uuid) companyId: string) {
    return this.success.customer(auth, companyId);
  }

  @Get('escalations')
  @RequirePermissions('success:read')
  escalations(@Auth() auth: AuthContext, @Query(new ZodPipe(escalationQuery)) q: z.infer<typeof escalationQuery>) {
    return this.success.escalations(auth, q);
  }

  @Post('escalations')
  @RequirePermissions('success:write')
  open(@Auth() auth: AuthContext, @Body(new ZodPipe(escalationInputSchema)) body: z.infer<typeof escalationInputSchema>, @Meta() meta: RequestMeta) {
    return this.success.openEscalation(auth, body, meta);
  }

  @Post('escalations/:id/resolve')
  @HttpCode(200)
  @RequirePermissions('success:write')
  resolve(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(escalationResolveSchema)) body: z.infer<typeof escalationResolveSchema>, @Meta() meta: RequestMeta) {
    return this.success.resolveEscalation(auth, id, body.resolution, meta);
  }
}
