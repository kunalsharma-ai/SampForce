import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  Header,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/auth-context';
import { SCIM_ERROR, SCIM_USER, ScimError, ScimService } from './scim.service';

const SCIM_JSON = 'application/scim+json';

/** Answers every failure in the SCIM error format (RFC 7644 §3.12). */
@Catch()
class ScimExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Scim');
  catch(e: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let detail = 'Something went wrong.';
    let scimType: string | undefined;
    if (e instanceof ScimError) ({ status, message: detail, scimType } = e);
    else if (e instanceof HttpException) {
      status = e.getStatus();
      const r = e.getResponse();
      detail = typeof r === 'object' && r && 'message' in r ? String((r as { message: unknown }).message) : e.message;
    } else this.logger.error({ err: e }, 'SCIM request failed');
    res.status(status).type(SCIM_JSON).json({ schemas: [SCIM_ERROR], status: String(status), ...(scimType ? { scimType } : {}), detail });
  }
}

type ScimRequest = Request & { scim?: { tenantId: string; tokenId: string } };

/**
 * SCIM 2.0 endpoint at /api/v1/scim/v2 for the workspace's identity provider (Okta, Microsoft Entra ID…).
 * Authenticated by a workspace SCIM token, not a user session. Users only; groups are not supported.
 */
@Public()
@UseFilters(ScimExceptionFilter)
@Throttle({ default: { limit: 1200, ttl: 60_000 } })
@Controller('scim/v2')
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  private async auth(req: ScimRequest) {
    return this.scim.authenticate(req.get('authorization'));
  }

  @SkipThrottle()
  @Get('ServiceProviderConfig')
  @Header('content-type', SCIM_JSON)
  config() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://dealflow.example/docs/scim',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'A SCIM token created in SampForce under Settings → Security.', primary: true }],
    };
  }

  @SkipThrottle()
  @Get('ResourceTypes')
  @Header('content-type', SCIM_JSON)
  resourceTypes() {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      Resources: [{ schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', schema: SCIM_USER }],
    };
  }

  @Get('Users')
  @Header('content-type', SCIM_JSON)
  async list(@Req() req: ScimRequest, @Query('filter') filter?: string, @Query('startIndex') startIndex?: string, @Query('count') count?: string) {
    const { tenantId } = await this.auth(req);
    return this.scim.list(tenantId, filter, Number(startIndex) || 1, count === undefined ? 100 : Number(count) || 0);
  }

  @Get('Users/:id')
  @Header('content-type', SCIM_JSON)
  async get(@Req() req: ScimRequest, @Param('id') id: string) {
    const { tenantId } = await this.auth(req);
    return this.scim.get(tenantId, id);
  }

  @Post('Users')
  @HttpCode(201)
  @Header('content-type', SCIM_JSON)
  async create(@Req() req: ScimRequest, @Body() body: unknown) {
    const { tenantId, tokenId } = await this.auth(req);
    return this.scim.create(tenantId, tokenId, body);
  }

  @Put('Users/:id')
  @Header('content-type', SCIM_JSON)
  async replace(@Req() req: ScimRequest, @Param('id') id: string, @Body() body: unknown) {
    const { tenantId, tokenId } = await this.auth(req);
    return this.scim.replace(tenantId, tokenId, id, body);
  }

  @Patch('Users/:id')
  @Header('content-type', SCIM_JSON)
  async patch(@Req() req: ScimRequest, @Param('id') id: string, @Body() body: unknown) {
    const { tenantId, tokenId } = await this.auth(req);
    return this.scim.patch(tenantId, tokenId, id, body);
  }

  @Delete('Users/:id')
  @HttpCode(204)
  async remove(@Req() req: ScimRequest, @Param('id') id: string) {
    const { tenantId, tokenId } = await this.auth(req);
    await this.scim.remove(tenantId, tokenId, id);
  }
}
