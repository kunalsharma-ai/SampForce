import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { type ConsoleSubscriptionsQuery, consoleSubscriptionsQuerySchema } from '@dealflow/types';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ConsoleSubscriptionsService } from './console-subscriptions.service';
import { Operator, type OperatorContext, OperatorGuard, OperatorPermission } from './operator-auth';

/** The Console's subscriptions and billing page (control center K4). Billing figures need billing.view as well. */
@Controller('operator/subscriptions')
@Public()
@UseGuards(OperatorGuard)
export class ConsoleSubscriptionsController {
  constructor(private readonly subscriptions: ConsoleSubscriptionsService) {}

  @Get('summary')
  @OperatorPermission('clients.view')
  summary(@Operator() op: OperatorContext, @Query(new ZodPipe(consoleSubscriptionsQuerySchema)) q: ConsoleSubscriptionsQuery) {
    return this.subscriptions.summary(op, q.days);
  }
}
