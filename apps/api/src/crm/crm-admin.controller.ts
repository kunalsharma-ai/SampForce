import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  type AttributionRule,
  attributionRuleSchema,
  type CurrencyRateInput,
  currencyRateSchema,
  type CurrencySettingsInput,
  currencySettingsSchema,
  type DashboardPolicy,
  dashboardPolicySchema,
  type ExportPolicy,
  exportPolicySchema,
  type NotificationSettings,
  notificationSettingsSchema,
  OPTION_LIST_KINDS,
  optionInputSchema,
  optionReorderSchema,
  type OptionUpdate,
  optionUpdateSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { CrmAdminService } from './crm-admin.service';

const kindParam = new ZodPipe(z.enum(OPTION_LIST_KINDS));
const valueParam = new ZodPipe(z.string().regex(/^[A-Z][A-Z0-9_]{0,59}$/));
const currencyParam = new ZodPipe(z.string().regex(/^[A-Z]{3}$/));
const kindQuery = z.object({ kind: z.enum(OPTION_LIST_KINDS) });

/**
 * Settings → CRM configuration, continued (ADR 0062). Reading options is open to everyone in the workspace (pickers
 * and badges need the labels); the other settings and every change need crm:configure.
 */
@Controller('crm-config')
export class CrmAdminController {
  constructor(private readonly admin: CrmAdminService) {}

  @Get('options')
  options(@Auth() auth: AuthContext, @Query(new ZodPipe(kindQuery)) q: z.infer<typeof kindQuery>) {
    return this.admin.options(auth, q.kind);
  }

  @Post('options/:kind')
  @RequirePermissions('crm:configure')
  createOption(@Auth() auth: AuthContext, @Param('kind', kindParam) kind: (typeof OPTION_LIST_KINDS)[number], @Body(new ZodPipe(optionInputSchema)) body: z.infer<typeof optionInputSchema>, @Meta() meta: RequestMeta) {
    return this.admin.createOption(auth, kind, body, meta);
  }

  @Put('options/order')
  @RequirePermissions('crm:configure')
  reorderOptions(@Auth() auth: AuthContext, @Body(new ZodPipe(optionReorderSchema)) body: z.infer<typeof optionReorderSchema>, @Meta() meta: RequestMeta) {
    return this.admin.reorderOptions(auth, body.kind, body.values, meta);
  }

  @Put('options/:kind/:value')
  @RequirePermissions('crm:configure')
  updateOption(@Auth() auth: AuthContext, @Param('kind', kindParam) kind: (typeof OPTION_LIST_KINDS)[number], @Param('value', valueParam) value: string, @Body(new ZodPipe(optionUpdateSchema)) body: OptionUpdate, @Meta() meta: RequestMeta) {
    return this.admin.updateOption(auth, kind, value, body, meta);
  }

  @Delete('options/:kind/:value')
  @HttpCode(204)
  @RequirePermissions('crm:configure')
  deleteOption(@Auth() auth: AuthContext, @Param('kind', kindParam) kind: (typeof OPTION_LIST_KINDS)[number], @Param('value', valueParam) value: string, @Meta() meta: RequestMeta) {
    return this.admin.deleteOption(auth, kind, value, meta);
  }

  @Get('notifications')
  @RequirePermissions('crm:configure')
  notifications(@Auth() auth: AuthContext) {
    return this.admin.notifications(auth);
  }

  @Put('notifications')
  @RequirePermissions('crm:configure')
  setNotifications(@Auth() auth: AuthContext, @Body(new ZodPipe(notificationSettingsSchema)) body: NotificationSettings, @Meta() meta: RequestMeta) {
    return this.admin.setNotifications(auth, body, meta);
  }

  /** Everyone reads the currencies (pickers offer the enabled ones first). */
  @Get('currency')
  currency(@Auth() auth: AuthContext) {
    return this.admin.currency(auth);
  }

  @Put('currency')
  @RequirePermissions('crm:configure')
  setCurrency(@Auth() auth: AuthContext, @Body(new ZodPipe(currencySettingsSchema)) body: CurrencySettingsInput, @Meta() meta: RequestMeta) {
    return this.admin.setCurrency(auth, body, meta);
  }

  @Post('currency/rates')
  @RequirePermissions('crm:configure')
  addRate(@Auth() auth: AuthContext, @Body(new ZodPipe(currencyRateSchema)) body: CurrencyRateInput, @Meta() meta: RequestMeta) {
    return this.admin.addRate(auth, body, meta);
  }

  @Delete('currency/rates/:currency')
  @RequirePermissions('crm:configure')
  removeRate(@Auth() auth: AuthContext, @Param('currency', currencyParam) currency: string, @Meta() meta: RequestMeta) {
    return this.admin.removeRate(auth, currency, meta);
  }

  @Get('export-policy')
  @RequirePermissions('crm:configure')
  exportPolicy(@Auth() auth: AuthContext) {
    return this.admin.exportPolicy(auth);
  }

  @Put('export-policy')
  @RequirePermissions('crm:configure')
  setExportPolicy(@Auth() auth: AuthContext, @Body(new ZodPipe(exportPolicySchema)) body: ExportPolicy, @Meta() meta: RequestMeta) {
    return this.admin.setExportPolicy(auth, body, meta);
  }

  @Get('dashboards')
  @RequirePermissions('crm:configure')
  dashboards(@Auth() auth: AuthContext) {
    return this.admin.dashboardPolicies(auth);
  }

  @Put('dashboards')
  @RequirePermissions('crm:configure')
  setDashboard(@Auth() auth: AuthContext, @Body(new ZodPipe(dashboardPolicySchema)) body: DashboardPolicy, @Meta() meta: RequestMeta) {
    return this.admin.setDashboardPolicy(auth, body, meta);
  }

  @Get('attribution')
  @RequirePermissions('crm:configure')
  attribution(@Auth() auth: AuthContext) {
    return this.admin.attribution(auth);
  }

  @Put('attribution')
  @RequirePermissions('crm:configure')
  setAttribution(@Auth() auth: AuthContext, @Body(new ZodPipe(attributionRuleSchema)) body: AttributionRule, @Meta() meta: RequestMeta) {
    return this.admin.setAttribution(auth, body, meta);
  }
}
