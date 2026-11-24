import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../common/auth-context';
import { ConsoleOverviewService } from './console-overview.service';
import { OperatorGuard, OperatorPermission } from './operator-auth';

/** The Console Overview dashboard (ADR 0074, C5b): Action Required, 18 KPIs and the charts in one call. */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class ConsoleOverviewController {
  constructor(private readonly overview: ConsoleOverviewService) {}

  @Get('overview/dashboard')
  @OperatorPermission('clients.view')
  dashboard() {
    return this.overview.dashboard();
  }
}
