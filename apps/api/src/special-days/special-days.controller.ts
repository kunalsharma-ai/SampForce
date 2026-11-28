import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { type CompanyEventsInput, companyEventsSchema, specialDaysQuery, type TodaySpecialDays, type z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, MobileAccess, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { OperatorGuard, OperatorPermission } from '../operator/operator-auth';
import { SpecialDaysService } from './special-days.service';

type Query = z.infer<typeof specialDaysQuery>;

/** Today's special days on the home dashboards (web and phone) and the company's own events. */
@Controller()
export class SpecialDaysController {
  constructor(private readonly days: SpecialDaysService) {}

  /** Everyone signed in sees today's holidays and events on their home dashboard. */
  @Get('special-days/today')
  @MobileAccess()
  today(@Auth() auth: AuthContext, @Query(new ZodPipe(specialDaysQuery)) q: Query): Promise<TodaySpecialDays> {
    return this.days.today(auth, q.date, q.zone);
  }

  @Get('crm-config/company-events')
  @RequirePermissions('crm:configure')
  events(@Auth() auth: AuthContext) {
    return this.days.events(auth);
  }

  @Put('crm-config/company-events')
  @RequirePermissions('crm:configure')
  setEvents(@Auth() auth: AuthContext, @Body(new ZodPipe(companyEventsSchema)) body: CompanyEventsInput, @Meta() meta: RequestMeta) {
    return this.days.setEvents(auth, body, meta);
  }
}

/** The Console Overview's special days: the operator's own country and the world days (no company events). */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class ConsoleSpecialDaysController {
  constructor(private readonly days: SpecialDaysService) {}

  @Get('special-days/today')
  @OperatorPermission('clients.view')
  today(@Query(new ZodPipe(specialDaysQuery)) q: Query): TodaySpecialDays {
    const country = this.days.countryFor(q.zone, null);
    return { date: q.date, country, days: this.days.publicDays(q.date, country) };
  }
}
