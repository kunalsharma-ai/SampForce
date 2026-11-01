import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type ApiKeyCreateInput, apiKeyCreateSchema, ZAPIER_EVENTS, type ZapierEvent, zapierSubscribeSchema } from '@dealflow/types';
import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ApiKeysService } from './api-keys.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Workspace API keys, managed by admins in the browser (never with a key). */
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @RequirePermissions('integrations:manage')
  list(@Auth() auth: AuthContext) {
    return this.keys.list(auth);
  }

  /** Whether the operator has published the DealFlow Zapier app, and how many Zapier subscriptions exist. */
  @Get('zapier')
  @RequirePermissions('integrations:manage')
  zapier(@Auth() auth: AuthContext) {
    return this.keys.zapierStatus(auth);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('integrations:manage')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(apiKeyCreateSchema)) body: ApiKeyCreateInput, @Meta() meta: RequestMeta) {
    return this.keys.create(auth, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('integrations:manage')
  revoke(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.keys.revoke(auth, id, meta);
  }
}

/** What the DealFlow Zapier app calls, with an API key: the connection test, REST-hook subscriptions and event data. */
@Controller('zapier')
@ApiKeyAccess()
export class ZapierController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.keys.me(auth);
  }

  @Post('hooks')
  @HttpCode(201)
  subscribe(@Auth() auth: AuthContext, @Body(new ZodPipe(zapierSubscribeSchema)) body: z.infer<typeof zapierSubscribeSchema>, @Meta() meta: RequestMeta) {
    return this.keys.subscribe(auth, body, meta);
  }

  @Delete('hooks/:id')
  @HttpCode(204)
  unsubscribe(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.keys.unsubscribe(auth, id, meta);
  }

  @Get('events/:id')
  event(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.keys.event(auth, id);
  }

  @Get('samples/:event')
  samples(@Auth() auth: AuthContext, @Param('event') event: string) {
    if (!(event in ZAPIER_EVENTS)) throw new BadRequestException({ code: 'UNKNOWN_EVENT', message: `Unknown event ${event}.` });
    return this.keys.samples(auth, event as ZapierEvent);
  }
}
