import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { contributorMarkSchema, stageChangeSchema, type z } from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { EmployeeStagesService } from './employee-stages.service';

const uuid = new ParseUUIDPipe();

/** Employee communication stages and RFQ contributors (ADR 0080). */
@Controller()
@ApiKeyAccess()
@RequireFeature('rfq_contributors')
export class EmployeeStagesController {
  constructor(private readonly stages: EmployeeStagesService) {}

  @Get('employee-stages')
  @RequirePermissions('contacts:read')
  list(@Auth() auth: AuthContext) {
    return this.stages.stages(auth);
  }

  @Get('companies/:id/employee-activity')
  @RequirePermissions('companies:read', 'contacts:read')
  activity(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.stages.activity(auth, id);
  }

  @Get('contacts/:id/communication')
  @RequirePermissions('contacts:read')
  communication(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.stages.communication(auth, id);
  }

  @Patch('contacts/:id/stage')
  @RequirePermissions('contacts:write')
  changeStage(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(stageChangeSchema)) body: z.output<typeof stageChangeSchema>, @Meta() meta: RequestMeta) {
    return this.stages.changeStage(auth, id, body, meta);
  }

  @Patch('contacts/:id/rfq-contributor')
  @RequirePermissions('contacts:write')
  mark(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(contributorMarkSchema)) body: z.output<typeof contributorMarkSchema>, @Meta() meta: RequestMeta) {
    return this.stages.markContributor(auth, id, body.marked, meta);
  }
}
