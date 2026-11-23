import { Controller, Get, Query } from '@nestjs/common';
import { type AuditLogFilters, type AuditLogPage, type AuditLogQuery, auditLogQuerySchema } from '@dealflow/types';
import { Auth, type AuthContext, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AuditViewService } from './audit-view.service';

export type { AuditLogRow } from '@dealflow/types';

/**
 * The organisation's audit log (ADR 0071, part 7): the Super Workspace reads all of it; a Manager Workspace reads its
 * own team's entries when the Super Workspace allows it; Executive Workspaces are refused.
 */
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly view: AuditViewService) {}

  @Get()
  @RequirePermissions('audit:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(auditLogQuerySchema)) q: AuditLogQuery): Promise<AuditLogPage> {
    return this.view.list(auth, q);
  }

  @Get('filters')
  @RequirePermissions('audit:read')
  filters(@Auth() auth: AuthContext): Promise<AuditLogFilters> {
    return this.view.filters(auth);
  }
}
