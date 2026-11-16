import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  CRM_STATUS_KINDS,
  type CrmStatusInput,
  crmStatusInputSchema,
  type CrmStatusUpdate,
  crmStatusUpdateSchema,
  type DepartmentInput,
  departmentInputSchema,
  type DesignationInput,
  designationInputSchema,
  type LeadNumberingInput,
  leadNumberingSchema,
  statusReorderSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { CrmConfigService } from './crm-config.service';

const uuid = new ParseUUIDPipe();
const kindQuery = z.object({ kind: z.enum(CRM_STATUS_KINDS) });

/** Settings → CRM Configuration. Everyone in the workspace can read it (pickers); changes need crm:configure. */
@Controller('crm-config')
export class CrmConfigController {
  constructor(private readonly config: CrmConfigService) {}

  @Get('statuses')
  statuses(@Auth() auth: AuthContext, @Query(new ZodPipe(kindQuery)) q: z.infer<typeof kindQuery>) {
    return this.config.statuses(auth, q.kind);
  }

  @Post('statuses')
  @RequirePermissions('crm:configure')
  createStatus(@Auth() auth: AuthContext, @Body(new ZodPipe(crmStatusInputSchema)) body: CrmStatusInput, @Meta() meta: RequestMeta) {
    return this.config.createStatus(auth, body, meta);
  }

  @Put('statuses/order')
  @RequirePermissions('crm:configure')
  reorder(@Auth() auth: AuthContext, @Body(new ZodPipe(statusReorderSchema)) body: z.infer<typeof statusReorderSchema>, @Meta() meta: RequestMeta) {
    return this.config.reorderStatuses(auth, body.kind, body.ids, meta);
  }

  @Put('statuses/:id')
  @RequirePermissions('crm:configure')
  updateStatus(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(crmStatusUpdateSchema)) body: CrmStatusUpdate, @Meta() meta: RequestMeta) {
    return this.config.updateStatus(auth, id, body, meta);
  }

  @Delete('statuses/:id')
  @HttpCode(204)
  @RequirePermissions('crm:configure')
  deleteStatus(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.config.deleteStatus(auth, id, meta);
  }

  @Get('departments')
  departments(@Auth() auth: AuthContext) {
    return this.config.departments(auth);
  }

  @Post('departments')
  @RequirePermissions('crm:configure')
  createDepartment(@Auth() auth: AuthContext, @Body(new ZodPipe(departmentInputSchema)) body: DepartmentInput, @Meta() meta: RequestMeta) {
    return this.config.saveDepartment(auth, null, body, meta);
  }

  @Put('departments/:id')
  @RequirePermissions('crm:configure')
  updateDepartment(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(departmentInputSchema)) body: DepartmentInput, @Meta() meta: RequestMeta) {
    return this.config.saveDepartment(auth, id, body, meta);
  }

  @Delete('departments/:id')
  @HttpCode(204)
  @RequirePermissions('crm:configure')
  deleteDepartment(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.config.deleteOrgItem(auth, 'department', id, meta);
  }

  @Get('designations')
  designations(@Auth() auth: AuthContext) {
    return this.config.designations(auth);
  }

  @Post('designations')
  @RequirePermissions('crm:configure')
  createDesignation(@Auth() auth: AuthContext, @Body(new ZodPipe(designationInputSchema)) body: DesignationInput, @Meta() meta: RequestMeta) {
    return this.config.saveDesignation(auth, null, body, meta);
  }

  @Put('designations/:id')
  @RequirePermissions('crm:configure')
  updateDesignation(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(designationInputSchema)) body: DesignationInput, @Meta() meta: RequestMeta) {
    return this.config.saveDesignation(auth, id, body, meta);
  }

  @Delete('designations/:id')
  @HttpCode(204)
  @RequirePermissions('crm:configure')
  deleteDesignation(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.config.deleteOrgItem(auth, 'designation', id, meta);
  }

  @Get('lead-numbering')
  numbering(@Auth() auth: AuthContext) {
    return this.config.numbering(auth);
  }

  @Put('lead-numbering')
  @RequirePermissions('crm:configure')
  setNumbering(@Auth() auth: AuthContext, @Body(new ZodPipe(leadNumberingSchema)) body: LeadNumberingInput, @Meta() meta: RequestMeta) {
    return this.config.setNumbering(auth, body, meta);
  }
}
