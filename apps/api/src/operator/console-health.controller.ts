import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { type HealthSettingsInput, healthSettingsSchema } from '@dealflow/types';
import type { Request } from 'express';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ConsoleHealthService } from './console-health.service';
import { Operator, OperatorAny, type OperatorContext, OperatorGuard, OperatorPermission } from './operator-auth';

const ip = (req: Request) => req.ip ?? null;

/** Client health score (ADR 0074, C5): one client's breakdown, a fresh measurement, and the weights in Settings. */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class ConsoleHealthController {
  constructor(private readonly health: ConsoleHealthService) {}

  @Get('clients/:id/health')
  @OperatorPermission('clients.view')
  async client(@Param('id', ParseUUIDPipe) id: string) {
    return { health: await this.health.detail(id) };
  }

  @Post('clients/:id/health')
  @OperatorPermission('clients.view')
  @HttpCode(200)
  async remeasure(@Operator() op: OperatorContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return { health: await this.health.remeasure(op, id, ip(req)) };
  }

  @Get('settings/health')
  @OperatorAny()
  settings() {
    return this.health.settings();
  }

  @Put('settings/health')
  @OperatorPermission('settings.manage')
  save(@Operator() op: OperatorContext, @Body(new ZodPipe(healthSettingsSchema)) body: HealthSettingsInput, @Req() req: Request) {
    return this.health.saveSettings(op, body, ip(req));
  }
}
