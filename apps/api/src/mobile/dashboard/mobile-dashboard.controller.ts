import { Controller, Get, Query } from '@nestjs/common';
import { type MobileDashboardQuery, mobileDashboardQuerySchema } from '@dealflow/types';
import { Auth, type AuthContext, MobileAccess } from '../../common/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { MobileDashboardService } from './mobile-dashboard.service';

/** The phone's home screen figures and its Sales targets screen (ADR 0072, M5). */
@MobileAccess()
@Controller('mobile')
export class MobileDashboardController {
  constructor(private readonly dashboard: MobileDashboardService) {}

  @Get('dashboard')
  get(@Auth() auth: AuthContext, @Query(new ZodPipe(mobileDashboardQuerySchema)) q: MobileDashboardQuery) {
    return this.dashboard.dashboard(auth, q.period);
  }

  @Get('targets')
  targets(@Auth() auth: AuthContext) {
    return this.dashboard.targets(auth);
  }
}
