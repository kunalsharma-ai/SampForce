import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { CompanyDealsService } from './company-deals.service';

const uuid = new ParseUUIDPipe();

/** Company to Deal (redesign R4, ADR 0084). */
@Controller('companies')
@ApiKeyAccess()
export class CompanyDealsController {
  constructor(private readonly companyDeals: CompanyDealsService) {}

  /** Marks the company as won: it becomes a client and its deal is made or closed as won. */
  @Post(':id/won')
  @HttpCode(200)
  @RequirePermissions('companies:write', 'deals:write')
  won(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.companyDeals.markWon(auth, id, meta);
  }
}
