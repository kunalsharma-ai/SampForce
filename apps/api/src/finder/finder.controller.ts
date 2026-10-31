import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type FinderSaveInput, finderSaveSchema, type FinderSearchInput, finderSearchSchema, z } from '@dealflow/types';
import { Auth, type AuthContext, ExtensionAccess, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { FinderService } from './finder.service';

const uuid = new ParseUUIDPipe();

@Controller('finder')
export class FinderController {
  constructor(private readonly finder: FinderService) {}

  @Get('usage')
  @RequirePermissions('leads:read')
  usage(@Auth() auth: AuthContext) {
    return this.finder.usage(auth);
  }

  @Get('lookups')
  @RequirePermissions('leads:read')
  history(@Auth() auth: AuthContext) {
    return this.finder.history(auth);
  }

  @Get('lookups/:id')
  @RequirePermissions('leads:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.finder.get(auth, id);
  }

  @Post('search')
  @HttpCode(200)
  @RequirePermissions('leads:read')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  search(@Auth() auth: AuthContext, @Body(new ZodPipe(finderSearchSchema)) body: FinderSearchInput) {
    return this.finder.search(auth, body);
  }

  @Post('lookups/:id/save')
  @HttpCode(200)
  @RequirePermissions('leads:write')
  save(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(finderSaveSchema)) body: FinderSaveInput, @Meta() meta: RequestMeta) {
    return this.finder.save(auth, id, body, meta);
  }
}

/** The extension's "find more at this company" button. */
@Controller('extension')
export class ExtensionFinderController {
  constructor(private readonly finder: FinderService) {}

  @Post('find')
  @HttpCode(200)
  @ExtensionAccess()
  @RequirePermissions('leads:read')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  find(@Auth() auth: AuthContext, @Body(new ZodPipe(z.object({ domain: z.string().trim().min(3).max(253) }))) body: { domain: string }) {
    return this.finder.search(auth, { company: body.domain });
  }
}
