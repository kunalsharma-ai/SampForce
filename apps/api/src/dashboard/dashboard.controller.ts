import { Controller, Get } from '@nestjs/common';
import type { DashboardSummary } from '@dealflow/types';
import { Auth, type AuthContext, RequirePermissions } from '../common/auth-context';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions('dashboard:read')
  summary(@Auth() auth: AuthContext): Promise<DashboardSummary> {
    return this.dashboard.summary(auth);
  }
}
