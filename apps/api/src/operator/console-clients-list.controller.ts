import { Body, Controller, Get, Header, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { type ConsoleClientBulkInput, consoleClientBulkSchema, type ConsoleClientListQuery, consoleClientListQuerySchema } from '@dealflow/types';
import type { Request, Response } from 'express';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ConsoleClientsListService } from './console-clients-list.service';
import { Operator, OperatorAny, type OperatorContext, OperatorGuard, OperatorPermission } from './operator-auth';

const ip = (req: Request) => req.ip ?? null;
const BOM = String.fromCharCode(0xfeff);

/**
 * The clients list with filters, sort and paging, its CSV export and bulk actions (ADR 0074, C4b). Registered before
 * the controller with `clients/:id`, so these fixed paths are matched first.
 */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class ConsoleClientsListController {
  constructor(private readonly list: ConsoleClientsListService) {}

  @Get('clients/page')
  @OperatorPermission('clients.view')
  page(@Operator() op: OperatorContext, @Query(new ZodPipe(consoleClientListQuerySchema)) q: ConsoleClientListQuery, @Req() req: Request) {
    return this.list.page(op, q, ip(req));
  }

  @Get('clients/export')
  @OperatorPermission('clients.view')
  @Header('Cache-Control', 'no-store')
  async export(@Operator() op: OperatorContext, @Query(new ZodPipe(consoleClientListQuerySchema)) q: ConsoleClientListQuery, @Req() req: Request, @Res() res: Response) {
    const { page: _page, perPage: _perPage, ...filters } = q;
    const csv = await this.list.exportCsv(op, filters, ip(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sampforce-clients-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`${BOM}${csv}`);
  }

  /** One action over the selected clients; the permission depends on the action (BULK_PERMISSION). */
  @Post('clients/bulk')
  @OperatorAny()
  @HttpCode(200)
  bulk(@Operator() op: OperatorContext, @Body(new ZodPipe(consoleClientBulkSchema)) body: ConsoleClientBulkInput, @Req() req: Request) {
    return this.list.bulk(op, body, ip(req));
  }
}
