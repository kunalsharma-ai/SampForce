import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  assignSchema,
  type CompanyInput,
  companyInputSchema,
  companyUpdateSchema,
  type ContactInput,
  contactInputSchema,
  contactUpdateSchema,
  type LeadConvertInput,
  leadConvertSchema,
  type LeadInput,
  leadInputSchema,
  leadUpdateSchema,
  type ListQuery,
  listQuerySchema,
  z,
} from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { CompaniesService } from './companies.service';
import { ContactsService } from './contacts.service';
import { LeadsService } from './leads.service';

const uuid = new ParseUUIDPipe();
const mergeSchema = z.object({ duplicateId: z.string().uuid() });

@Controller('leads')
@ApiKeyAccess()
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermissions('leads:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuerySchema)) q: ListQuery) {
    return this.leads.list(auth, q);
  }

  @Post()
  @RequirePermissions('leads:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(leadInputSchema)) body: LeadInput, @Meta() meta: RequestMeta) {
    return this.leads.create(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('leads:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.leads.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('leads:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(leadUpdateSchema)) body: Partial<LeadInput>, @Meta() meta: RequestMeta) {
    return this.leads.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('leads:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.leads.remove(auth, id, meta);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions('leads:write')
  assign(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(assignSchema)) body: { ownerId: string }, @Meta() meta: RequestMeta) {
    return this.leads.update(auth, id, { ownerId: body.ownerId }, meta);
  }

  @Get(':id/duplicates')
  @RequirePermissions('leads:read')
  duplicates(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.leads.duplicates(auth, id);
  }

  @Post(':id/merge')
  @HttpCode(200)
  @RequirePermissions('leads:write')
  merge(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(mergeSchema)) body: { duplicateId: string }, @Meta() meta: RequestMeta) {
    return this.leads.merge(auth, id, body.duplicateId, meta);
  }

  /** Conversion creates a contact (and usually a company and a deal), so it needs write access to those too. */
  @Post(':id/convert')
  @HttpCode(200)
  @RequirePermissions('leads:write', 'contacts:write', 'companies:write', 'deals:write')
  convert(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(leadConvertSchema)) body: LeadConvertInput, @Meta() meta: RequestMeta) {
    return this.leads.convert(auth, id, body, meta);
  }
}

@Controller('contacts')
@ApiKeyAccess()
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions('contacts:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuerySchema)) q: ListQuery) {
    return this.contacts.list(auth, q);
  }

  @Post()
  @RequirePermissions('contacts:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(contactInputSchema)) body: ContactInput, @Meta() meta: RequestMeta) {
    return this.contacts.create(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('contacts:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.contacts.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('contacts:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(contactUpdateSchema)) body: Partial<ContactInput>, @Meta() meta: RequestMeta) {
    return this.contacts.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('contacts:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.contacts.remove(auth, id, meta);
  }
}

@Controller('companies')
@ApiKeyAccess()
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermissions('companies:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuerySchema)) q: ListQuery) {
    return this.companies.list(auth, q);
  }

  @Post()
  @RequirePermissions('companies:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(companyInputSchema)) body: CompanyInput, @Meta() meta: RequestMeta) {
    return this.companies.create(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('companies:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.companies.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('companies:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(companyUpdateSchema)) body: Partial<CompanyInput>, @Meta() meta: RequestMeta) {
    return this.companies.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('companies:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.companies.remove(auth, id, meta);
  }
}
