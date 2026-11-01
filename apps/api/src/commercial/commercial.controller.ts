import { Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  commercialSettingsSchema,
  type ContractInput,
  contractInputSchema,
  contractSignSchema,
  contractTerminateSchema,
  contractUpdateSchema,
  type PriceBookInput,
  priceBookInputSchema,
  type ProductInput,
  productInputSchema,
  proposalSendSchema,
  type ProposalSendInput,
  type QuoteInput,
  quoteInputSchema,
  quoteTransitionSchema,
  type QuoteUpdate,
  quoteUpdateSchema,
  taxRateInputSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { CatalogService } from './catalog.service';
import { ContractsService } from './contracts.service';
import { ProposalsService } from './proposals.service';
import { renderQuotePdf } from './quote-pdf';
import { QuotesService } from './quotes.service';

const uuid = new ParseUUIDPipe();
const priceBody = z.object({ unitPrice: z.coerce.number().min(0).max(1e12).nullable() });
const quoteListQuery = z.object({ opportunityId: z.string().uuid().optional(), status: z.string().max(30).optional(), allVersions: z.coerce.boolean().optional() });
const contractListQuery = z.object({ status: z.string().max(30).optional(), companyId: z.string().uuid().optional(), renewalWithinDays: z.coerce.number().int().min(0).max(730).optional() });
const includeInactive = z.object({ all: z.coerce.boolean().optional() });

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @RequirePermissions('quotes:read')
  products(@Auth() auth: AuthContext, @Query(new ZodPipe(includeInactive)) q: z.infer<typeof includeInactive>) {
    return this.catalog.products(auth, q.all);
  }

  @Post('products')
  @RequirePermissions('catalog:manage')
  createProduct(@Auth() auth: AuthContext, @Body(new ZodPipe(productInputSchema)) body: ProductInput, @Meta() meta: RequestMeta) {
    return this.catalog.saveProduct(auth, null, body, meta);
  }

  @Put('products/:id')
  @RequirePermissions('catalog:manage')
  updateProduct(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(productInputSchema)) body: ProductInput, @Meta() meta: RequestMeta) {
    return this.catalog.saveProduct(auth, id, body, meta);
  }

  @Get('price-books')
  @RequirePermissions('quotes:read')
  priceBooks(@Auth() auth: AuthContext) {
    return this.catalog.priceBooks(auth);
  }

  @Post('price-books')
  @RequirePermissions('catalog:manage')
  createPriceBook(@Auth() auth: AuthContext, @Body(new ZodPipe(priceBookInputSchema)) body: PriceBookInput, @Meta() meta: RequestMeta) {
    return this.catalog.savePriceBook(auth, null, body, meta);
  }

  @Put('price-books/:id')
  @RequirePermissions('catalog:manage')
  updatePriceBook(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(priceBookInputSchema)) body: PriceBookInput, @Meta() meta: RequestMeta) {
    return this.catalog.savePriceBook(auth, id, body, meta);
  }

  @Put('price-books/:id/prices/:productId')
  @HttpCode(204)
  @RequirePermissions('catalog:manage')
  setPrice(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('productId', uuid) productId: string, @Body(new ZodPipe(priceBody)) body: z.infer<typeof priceBody>, @Meta() meta: RequestMeta) {
    return this.catalog.setPrice(auth, id, productId, body.unitPrice, meta);
  }

  @Get('tax-rates')
  @RequirePermissions('quotes:read')
  taxRates(@Auth() auth: AuthContext) {
    return this.catalog.taxRates(auth);
  }

  @Post('tax-rates')
  @RequirePermissions('catalog:manage')
  createTaxRate(@Auth() auth: AuthContext, @Body(new ZodPipe(taxRateInputSchema)) body: z.infer<typeof taxRateInputSchema>, @Meta() meta: RequestMeta) {
    return this.catalog.saveTaxRate(auth, null, body, meta);
  }

  @Put('tax-rates/:id')
  @RequirePermissions('catalog:manage')
  updateTaxRate(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(taxRateInputSchema)) body: z.infer<typeof taxRateInputSchema>, @Meta() meta: RequestMeta) {
    return this.catalog.saveTaxRate(auth, id, body, meta);
  }

  @Get('settings')
  @RequirePermissions('quotes:read')
  settings(@Auth() auth: AuthContext) {
    return this.catalog.settings(auth);
  }

  @Patch('settings')
  @RequirePermissions('catalog:manage')
  updateSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(commercialSettingsSchema)) body: z.infer<typeof commercialSettingsSchema>, @Meta() meta: RequestMeta) {
    return this.catalog.updateSettings(auth, body, meta);
  }
}

@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly prisma: PrismaService,
    private readonly proposals: ProposalsService,
  ) {}

  /** Email the proposal with its online link from your mailbox; an approved quote becomes Sent. */
  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions('quotes:write', 'activities:write')
  send(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(proposalSendSchema)) body: ProposalSendInput, @Meta() meta: RequestMeta) {
    return this.proposals.send(auth, id, body, meta);
  }

  @Get(':id/share')
  @RequirePermissions('quotes:read')
  async shareInfo(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    const q = await this.quotes.get(auth, id);
    return { enabled: q.share.enabled, url: this.proposals.linkFor(auth, q) };
  }

  /** Turn the online link on or off; off revokes every copy of the link to this version. */
  @Post(':id/share')
  @HttpCode(200)
  @RequirePermissions('quotes:write')
  share(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(z.object({ enabled: z.boolean() }))) body: { enabled: boolean }, @Meta() meta: RequestMeta) {
    return this.proposals.share(auth, id, body.enabled, meta);
  }

  @Get()
  @RequirePermissions('quotes:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(quoteListQuery)) q: z.infer<typeof quoteListQuery>) {
    return this.quotes.list(auth, q);
  }

  @Post()
  @RequirePermissions('quotes:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(quoteInputSchema)) body: QuoteInput, @Meta() meta: RequestMeta) {
    return this.quotes.create(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('quotes:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.quotes.get(auth, id);
  }

  @Get(':id/versions')
  @RequirePermissions('quotes:read')
  versions(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.quotes.versions(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('quotes:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(quoteUpdateSchema)) body: QuoteUpdate, @Meta() meta: RequestMeta) {
    return this.quotes.update(auth, id, body, meta);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequirePermissions('quotes:write')
  transition(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(quoteTransitionSchema)) body: z.infer<typeof quoteTransitionSchema>, @Meta() meta: RequestMeta) {
    return this.quotes.transition(auth, id, body.action, { updateDealAmount: body.updateDealAmount }, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('quotes:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.quotes.remove(auth, id, meta);
  }

  @Get(':id/pdf')
  @RequirePermissions('quotes:read')
  async pdf(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response) {
    const quote = await this.quotes.get(auth, id);
    const [tenant, settings] = await this.prisma.run(auth, (tx) =>
      Promise.all([tx.tenant.findFirstOrThrow({ where: { id: auth.tenantId }, select: { name: true } }), tx.commercialSettings.findUnique({ where: { tenantId: auth.tenantId } })]),
    );
    const pdf = await renderQuotePdf(quote, { name: tenant.name, logoDataUrl: settings?.logoDataUrl, header: settings?.proposalHeader, footer: settings?.proposalFooter });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${quote.reference.replace(/\s+/g, '-')}.pdf"`);
    res.setHeader('cache-control', 'no-store');
    res.end(pdf);
  }
}

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @RequirePermissions('contracts:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(contractListQuery)) q: z.infer<typeof contractListQuery>) {
    return this.contracts.list(auth, q);
  }

  @Post()
  @RequirePermissions('contracts:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(contractInputSchema)) body: ContractInput, @Meta() meta: RequestMeta) {
    return this.contracts.create(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('contracts:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.contracts.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('contracts:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(contractUpdateSchema)) body: z.infer<typeof contractUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.contracts.update(auth, id, body, meta);
  }

  @Post(':id/sign')
  @HttpCode(200)
  @RequirePermissions('contracts:write')
  sign(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(contractSignSchema)) body: z.infer<typeof contractSignSchema>, @Meta() meta: RequestMeta) {
    return this.contracts.sign(auth, id, body, meta);
  }

  @Post(':id/terminate')
  @HttpCode(200)
  @RequirePermissions('contracts:write')
  terminate(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(contractTerminateSchema)) body: z.infer<typeof contractTerminateSchema>, @Meta() meta: RequestMeta) {
    return this.contracts.terminate(auth, id, body.reason, meta);
  }

  @Post(':id/renew')
  @HttpCode(200)
  @RequirePermissions('contracts:write')
  renew(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.contracts.renew(auth, id, meta);
  }
}

/** The customer-facing proposal page reads these; the token is signed and works only while sharing is on. */
@Controller('proposals')
export class PublicProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('view/:token')
  @Header('cache-control', 'no-store, private')
  async view(@Param('token') token: string, @Query('preview') preview?: string) {
    const p = await this.proposals.view(token, { count: preview !== '1' });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'This proposal link is not valid or is no longer shared.' });
    return p;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('view/:token/pay')
  @HttpCode(200)
  async pay(@Param('token') token: string) {
    const out = await this.proposals.pay(token);
    if (!out) throw new NotFoundException({ code: 'NOT_FOUND', message: 'This proposal link is not valid or is no longer shared.' });
    return out;
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('view/:token/pdf')
  async pdf(@Param('token') token: string, @Res() res: Response) {
    const out = await this.proposals.publicPdf(token);
    if (!out) {
      res.status(404).type('text/plain').send('This proposal link is not valid or is no longer shared.');
      return;
    }
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('cache-control', 'no-store');
    res.end(out.pdf);
  }
}
