import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  MOBILE_RECORD_MODULES_LIVE,
  type MobileLiveRecordModule,
  type MobileRecordListQuery,
  mobileRecordListQuerySchema,
  type MobileRecordWrite,
  mobileRecordWriteSchema,
} from '@dealflow/types';
import type { FeatureKey } from '@dealflow/types';
import { Auth, type AuthContext, Meta, MobileAccess, type RequestMeta, RequireFeature } from '../../common/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { MobileRecordsService } from './mobile-records.service';
import { ConfirmPassword } from '../../common/password-confirmation';

const moduleParam = (m: string): MobileLiveRecordModule => {
  if (!(MOBILE_RECORD_MODULES_LIVE as readonly string[]).includes(m)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
  return m as MobileLiveRecordModule;
};

/** The catalogue feature of each phone module, so the workspace's Delete permission applies on the phone too (W2). */
const MODULE_FEATURE: Record<MobileLiveRecordModule, FeatureKey> = {
  companies: 'account_management',
  contacts: 'contact_management',
  follow_ups: 'follow_up_management',
  tasks: 'task_management',
};

/**
 * Leads, contacts, follow-ups and tasks on the phone (ADR 0072, M4). Every route runs the web's own CRM services
 * under the person's permissions and hierarchy, then applies their Mobile Configuration field rules.
 */
@MobileAccess()
@Controller('mobile/records')
export class MobileRecordsController {
  constructor(private readonly records: MobileRecordsService) {}

  @Get('options')
  options(@Auth() auth: AuthContext) {
    return this.records.options(auth);
  }

  @Get(':module')
  list(@Auth() auth: AuthContext, @Param('module') module: string, @Query(new ZodPipe(mobileRecordListQuerySchema)) q: MobileRecordListQuery) {
    return this.records.list(auth, moduleParam(module), q);
  }

  @Get(':module/:id')
  get(@Auth() auth: AuthContext, @Param('module') module: string, @Param('id', ParseUUIDPipe) id: string, @Query('tz') tz?: string) {
    return this.records.get(auth, moduleParam(module), id, typeof tz === 'string' && tz.length <= 64 ? tz : undefined);
  }

  @Post(':module')
  create(@Auth() auth: AuthContext, @Param('module') module: string, @Body(new ZodPipe(mobileRecordWriteSchema)) body: MobileRecordWrite, @Meta() meta: RequestMeta) {
    return this.records.create(auth, moduleParam(module), body, meta);
  }

  @Patch(':module/:id')
  update(@Auth() auth: AuthContext, @Param('module') module: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(mobileRecordWriteSchema)) body: MobileRecordWrite, @Meta() meta: RequestMeta) {
    return this.records.update(auth, moduleParam(module), id, body, meta);
  }

  @ConfirmPassword()
  @RequireFeature((req) => MODULE_FEATURE[(req.params as { module?: string }).module as MobileLiveRecordModule] ?? null)
  @Delete(':module/:id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('module') module: string, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    await this.records.remove(auth, moduleParam(module), id, meta);
  }
}
