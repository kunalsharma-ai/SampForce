import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { firstEmailQuerySchema, followUpCadenceSchema, initialEmailSchema, type InitialEmailInput } from '@dealflow/types';
import type { z } from 'zod';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { FirstEmailService } from './first-email.service';
import { FollowUpCadenceService } from './follow-up-cadence.service';

const uuid = new ParseUUIDPipe();

/** The follow-up cadence (redesign R3, ADR 0083): its settings and each employee's place in it. */
@Controller()
@ApiKeyAccess()
@RequireFeature('follow_up_management')
export class FollowUpCadenceController {
  constructor(
    private readonly cadence: FollowUpCadenceService,
    private readonly firstEmail: FirstEmailService,
  ) {}

  /** Everyone reads it: the employee cards say "Follow-up 2 of 5". */
  @Get('crm-config/follow-up-cadence')
  @RequirePermissions('contacts:read')
  settings(@Auth() auth: AuthContext) {
    return this.cadence.settings(auth);
  }

  @Put('crm-config/follow-up-cadence')
  @RequirePermissions('crm:configure')
  setSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(followUpCadenceSchema)) body: z.output<typeof followUpCadenceSchema>, @Meta() meta: RequestMeta) {
    return this.cadence.setSettings(auth, body, meta);
  }

  @Get('contacts/:id/cadence')
  @RequirePermissions('contacts:read')
  contact(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.cadence.contactCadence(auth, id);
  }

  /** The initial email went out outside SampForce: record it, and the cadence starts from then. */
  @Post('contacts/:id/initial-email')
  @HttpCode(200)
  @RequirePermissions('contacts:write')
  initialEmail(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(initialEmailSchema)) body: InitialEmailInput, @Meta() meta: RequestMeta) {
    return this.cadence.markInitialEmail(auth, id, body, meta);
  }

  /** First Email Pending (ADR 0096): contacts whose first email has not gone out, and those waiting for follow-up 1. */
  @Get('follow-ups/first-email')
  @RequirePermissions('contacts:read')
  firstEmails(@Auth() auth: AuthContext, @Query(new ZodPipe(firstEmailQuerySchema)) q: z.output<typeof firstEmailQuerySchema>) {
    return this.firstEmail.list(auth, q);
  }
}
