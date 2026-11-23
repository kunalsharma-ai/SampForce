import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  type ConsoleAuthorityInput,
  consoleAuthoritySchema,
  consoleClientCreateSchema,
  consoleClientStateSchema,
  type ConsolePreferencesUpdate,
  consolePreferencesUpdateSchema,
  consoleSearchQuerySchema,
  type ConsolePlanCreateInput,
  consolePlanCreateSchema,
  type ConsolePlanUpdateInput,
  consolePlanUpdateSchema,
  type ConsoleRenewInput,
  consoleRenewSchema,
  type ConsoleSubscriptionInput,
  consoleSubscriptionSchema,
  emailSchema,
  type OperatorFeatureOverridesInput,
  operatorFeatureOverridesSchema,
  type OperatorPlanDefinitionInput,
  operatorPlanDefinitionSchema,
  PLAN_CODES,
  type PlanCode,
  type OperatorPaymentInput,
  type OperatorPlanInput,
  operatorLoginSchema,
  operatorPaymentSchema,
  operatorPlanSchema,
  operatorStatusSchema,
  operatorVoidSchema,
  paymentInstructionsSchema,
  PROVIDER_CHECK_KEYS,
  PROVIDER_KEYS,
  type ProviderCheckKey,
  type ProviderKey,
  type ProviderKeysUpdateInput,
  providerKeysUpdateSchema,
  z,
  type PlatformAuditQuery,
  platformAuditQuerySchema,
} from '@dealflow/types';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { Operator, type OperatorContext, OperatorGuard, OperatorAny, OperatorPermission, OperatorPublic, OperatorTokens } from './operator-auth';
import { ConsoleService } from './console.service';
import { ConsoleShellService } from './console-shell.service';
import { OperatorService } from './operator.service';

const ip = (req: Request) => req.ip ?? null;

/** `@Public()` only skips the workspace guard; every route here is protected by OperatorGuard instead. */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class OperatorController {
  constructor(
    private readonly ops: OperatorService,
    private readonly tokens: OperatorTokens,
    private readonly console: ConsoleService,
    private readonly shell: ConsoleShellService,
  ) {}

  // ───── Console Admin (ADR 0071): platform overview, client organisations, plans and workspace limits ─────

  /** Platform figures for the Console dashboard. No individual sales records. */
  @Get('overview')
  @OperatorPermission('clients.view')
  overview() {
    return this.console.overview();
  }

  @Get('clients')
  @OperatorPermission('clients.view')
  clients(@Operator() op: OperatorContext, @Query(new ZodPipe(z.object({ search: z.string().trim().max(100).optional() }))) q: { search?: string }, @Req() req: Request) {
    return this.console.clients(op, q.search, ip(req));
  }

  /** A new client organisation with its Super Workspace, subscription and an invitation for its administrator. */
  @Post('clients')
  @OperatorPermission('clients.edit')
  createClient(@Operator() op: OperatorContext, @Body(new ZodPipe(consoleClientCreateSchema)) body: z.output<typeof consoleClientCreateSchema>, @Req() req: Request) {
    return this.console.createClient(op, body, ip(req));
  }

  @Get('clients/:id')
  @OperatorPermission('clients.view')
  client(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.console.client(op, id, ip(req));
  }

  @Put('clients/:id/subscription')
  @OperatorPermission('subscriptions.manage')
  subscription(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(consoleSubscriptionSchema)) body: ConsoleSubscriptionInput, @Req() req: Request) {
    return this.console.setSubscription(op, id, body, ip(req));
  }

  @Post('clients/:id/renew')
  @OperatorPermission('subscriptions.manage')
  @HttpCode(200)
  renew(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(consoleRenewSchema)) body: ConsoleRenewInput, @Req() req: Request) {
    return this.console.renew(op, id, body, ip(req));
  }

  @Post('clients/:id/state')
  @OperatorPermission('clients.status')
  @HttpCode(200)
  clientState(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(consoleClientStateSchema)) body: z.infer<typeof consoleClientStateSchema>, @Req() req: Request) {
    return this.console.setState(op, id, body.state, body.reason, ip(req));
  }

  @Put('clients/:id/authority')
  @OperatorPermission('clients.edit')
  authority(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(consoleAuthoritySchema)) body: ConsoleAuthorityInput, @Req() req: Request) {
    return this.console.setAuthority(op, id, body, ip(req));
  }

  /** A new invitation link for the client's administrator (the earlier one stops working). */
  @Post('clients/:id/administrator-invitation')
  @OperatorPermission('users.manage')
  @HttpCode(200)
  inviteAdministrator(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(z.object({ email: emailSchema.optional() }).strict())) body: { email?: string }, @Req() req: Request) {
    return this.console.resendAdministrator(op, id, body.email, ip(req));
  }

  /** Every plan, shipped and Console-made, with its features, limits and commercial terms. */
  @Get('console-plans')
  @OperatorPermission('clients.view')
  consolePlans() {
    return this.console.plans();
  }

  @Post('console-plans')
  @OperatorPermission('plans.manage')
  createPlan(@Operator() op: OperatorContext, @Body(new ZodPipe(consolePlanCreateSchema)) body: ConsolePlanCreateInput, @Req() req: Request) {
    return this.console.createPlan(op, body, ip(req));
  }

  @Patch('console-plans/:code')
  @OperatorPermission('plans.manage')
  updatePlan(@Operator() op: OperatorContext, @Param('code', new ZodPipe(z.string().regex(/^[a-z0-9_]{1,60}$/))) code: string, @Body(new ZodPipe(consolePlanUpdateSchema)) body: ConsolePlanUpdateInput, @Req() req: Request) {
    return this.console.updatePlan(op, code, body, ip(req));
  }

  /** The signed-in operator with their Console palette, colour mode, sidebar and sound (ADR 0074). */
  @Get('me')
  @OperatorAny()
  me(@Operator() op: OperatorContext) {
    return this.shell.me(op);
  }

  @Put('me/preferences')
  @OperatorAny()
  setPreferences(@Operator() op: OperatorContext, @Body(new ZodPipe(consolePreferencesUpdateSchema)) body: ConsolePreferencesUpdate) {
    return this.shell.setPreferences(op, body);
  }

  /** Global search (Ctrl/⌘ K): clients, people, workspaces, invoices, tickets and plans by name, email or number. */
  @Get('search')
  @OperatorAny()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  search(@Operator() op: OperatorContext, @Query(new ZodPipe(consoleSearchQuerySchema)) q: { q: string }, @Req() req: Request) {
    return this.shell.search(op, q.q, ip(req));
  }

  @Get('tenants')
  @OperatorPermission('clients.view')
  tenants(@Operator() op: OperatorContext, @Query(new ZodPipe(z.object({ search: z.string().trim().max(100).optional() }))) q: { search?: string }, @Req() req: Request) {
    return this.ops.tenants(op, q, ip(req));
  }

  @Get('tenants/:id')
  @OperatorPermission('clients.view')
  tenant(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.ops.tenant(op, id, ip(req));
  }

  @Post('tenants/:id/plan')
  @OperatorPermission('subscriptions.manage')
  @HttpCode(200)
  plan(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(operatorPlanSchema)) body: OperatorPlanInput, @Req() req: Request) {
    return this.ops.setPlan(op, id, body, ip(req));
  }

  @Post('tenants/:id/status')
  @OperatorPermission('clients.status')
  @HttpCode(200)
  status(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(operatorStatusSchema)) body: z.infer<typeof operatorStatusSchema>, @Req() req: Request) {
    return this.ops.setSuspended(op, id, body.suspended, body.reason, ip(req));
  }

  /** Offline invoices waiting for payment, across workspaces. */
  @Get('invoices/open')
  @OperatorPermission('billing.view')
  openInvoices() {
    return this.ops.openInvoices();
  }

  @Post('tenants/:id/invoices/:invoiceId/paid')
  @OperatorPermission('billing.manage')
  @HttpCode(200)
  paid(
    @Operator() op: OperatorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body(new ZodPipe(operatorPaymentSchema)) body: OperatorPaymentInput,
    @Req() req: Request,
  ) {
    return this.ops.recordPayment(op, id, invoiceId, body, ip(req));
  }

  @Post('tenants/:id/invoices/:invoiceId/void')
  @OperatorPermission('billing.manage')
  @HttpCode(200)
  voidInvoice(
    @Operator() op: OperatorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body(new ZodPipe(operatorVoidSchema)) body: z.infer<typeof operatorVoidSchema>,
    @Req() req: Request,
  ) {
    return this.ops.voidInvoice(op, id, invoiceId, body.reason, ip(req));
  }

  /** Every plan's features and limits, as workspaces get them now (ADR 0057). */
  @Get('plans')
  @OperatorPermission('clients.view')
  plans() {
    return this.ops.plans();
  }

  /** Changes what a plan includes, for every workspace on it at once. Admins only; logged with the reason. */
  @Put('plans/:code')
  @OperatorPermission('plans.manage')
  setPlanDefinition(
    @Operator() op: OperatorContext,
    @Param('code', new ZodPipe(z.enum(PLAN_CODES))) code: PlanCode,
    @Body(new ZodPipe(operatorPlanDefinitionSchema)) body: OperatorPlanDefinitionInput,
    @Req() req: Request,
  ) {
    return this.ops.setPlanDefinition(op, code, body, ip(req));
  }

  /** Grants or withholds features for one workspace whatever its plan says. Admins only; in both audit logs. */
  @Post('tenants/:id/features')
  @OperatorPermission('features.manage')
  @HttpCode(200)
  features(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(operatorFeatureOverridesSchema)) body: OperatorFeatureOverridesInput, @Req() req: Request) {
    return this.ops.setFeatureOverrides(op, id, body, ip(req));
  }

  @Get('settings')
  @OperatorPermission('system.view')
  settings() {
    return this.ops.settings();
  }

  @Post('settings/payment-instructions')
  @OperatorPermission('settings.manage')
  @HttpCode(200)
  paymentInstructions(@Operator() op: OperatorContext, @Body(new ZodPipe(paymentInstructionsSchema)) body: z.infer<typeof paymentInstructionsSchema>, @Req() req: Request) {
    return this.ops.setPaymentInstructions(op, body.instructions, ip(req));
  }

  @Get('providers')
  @OperatorPermission('system.view')
  providers() {
    return this.ops.providers();
  }

  /** The few settings that stay in the deployment's environment, and why. Secret values are never returned. */
  @Get('deployment')
  @OperatorPermission('system.view')
  deployment() {
    return this.ops.deploymentSettings();
  }

  /** Saves or removes keys entered in the console. Admins only; values are sealed, never returned, and every change is logged. */
  @Post('providers/:key/keys')
  @OperatorPermission('providers.manage')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  setProviderKeys(
    @Operator() op: OperatorContext,
    @Param('key', new ZodPipe(z.enum(PROVIDER_KEYS))) key: ProviderKey,
    @Body(new ZodPipe(providerKeysUpdateSchema)) body: ProviderKeysUpdateInput,
    @Req() req: Request,
  ) {
    return this.ops.setProviderKeys(op, key, body, ip(req));
  }

  /** Runs one no-cost call with the deployment's key. Admins only: it spends a provider request. */
  @Post('providers/:key/check')
  @OperatorPermission('providers.manage')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkProvider(@Operator() op: OperatorContext, @Param('key', new ZodPipe(z.enum(PROVIDER_CHECK_KEYS))) key: ProviderCheckKey, @Req() req: Request) {
    return this.ops.checkProvider(op, key, ip(req));
  }

  @Get('audit-log')
  @OperatorPermission('audit.view')
  auditLog(@Query(new ZodPipe(platformAuditQuerySchema)) q: PlatformAuditQuery) {
    return this.ops.auditLog(q);
  }
}
