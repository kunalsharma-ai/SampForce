import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type ConsoleActivityQuery, consoleActivityQuerySchema, type PlatformAuditQuery, platformAuditQuerySchema } from '@dealflow/types';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ConsoleAuditService } from './console-audit.service';
import { Operator, type OperatorContext, OperatorGuard, OperatorPermission } from './operator-auth';

const ip = (req: Request) => req.ip ?? null;
const BOM = String.fromCharCode(0xfeff);

/** The platform audit log (search, entry detail with before/after, CSV export) and the activity feed (ADR 0074, C3). */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class ConsoleAuditController {
  constructor(private readonly audit: ConsoleAuditService) {}

  @Get('audit-log')
  @OperatorPermission('audit.view')
  list(@Query(new ZodPipe(platformAuditQuerySchema)) q: PlatformAuditQuery) {
    return this.audit.list(q);
  }

  @Get('audit-log/export')
  @OperatorPermission('audit.view')
  @Header('Cache-Control', 'no-store')
  async export(@Operator() op: OperatorContext, @Query(new ZodPipe(platformAuditQuerySchema)) q: PlatformAuditQuery, @Req() req: Request, @Res() res: Response) {
    const { limit: _limit, before: _before, ...filters } = q;
    const out = await this.audit.exportCsv(op, filters, ip(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sampforce-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('X-Export-Rows', String(out.rows));
    res.setHeader('X-Export-Capped', String(out.capped));
    // A byte-order mark so spreadsheet apps read the file as UTF-8.
    res.send(`${BOM}${out.csv}`);
  }

  @Get('audit-log/:id')
  @OperatorPermission('audit.view')
  entry(@Param('id', ParseUUIDPipe) id: string) {
    return this.audit.entry(id);
  }

  @Get('activity')
  @OperatorPermission('clients.view')
  activity(@Operator() op: OperatorContext, @Query(new ZodPipe(consoleActivityQuerySchema)) q: ConsoleActivityQuery) {
    return this.audit.activity(op, q);
  }
}
