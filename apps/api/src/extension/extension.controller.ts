import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type ExtensionCaptureInput,
  extensionCaptureSchema,
  type ExtensionLookupInput,
  extensionLookupSchema,
  type ExtensionTokenCreateInput,
  extensionTokenCreateSchema,
} from '@dealflow/types';
import { Auth, type AuthContext, ExtensionAccess, Meta, type RequestMeta, RequirePermissions, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ExtensionService } from './extension.service';

/** Connections are managed from the web app only; an extension token cannot create or list them. */
@Controller('extension/connections')
@RequireFeature('browser_extension')
export class ExtensionConnectionsController {
  constructor(private readonly extension: ExtensionService) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.extension.listTokens(auth);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(extensionTokenCreateSchema)) body: ExtensionTokenCreateInput, @Meta() meta: RequestMeta) {
    return this.extension.createToken(auth, body.name, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Meta() meta: RequestMeta) {
    return this.extension.revokeToken(auth, id, meta);
  }
}

@Controller('extension')
@RequireFeature('browser_extension')
@ExtensionAccess()
export class ExtensionController {
  constructor(private readonly extension: ExtensionService) {}

  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.extension.me(auth);
  }

  /** The extension ends its own connection when the person disconnects it. */
  @Post('disconnect')
  @HttpCode(204)
  disconnect(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.extension.revokeToken(auth, auth.sessionId, meta);
  }

  @Post('lookup')
  @HttpCode(200)
  @RequirePermissions('leads:read')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  lookup(@Auth() auth: AuthContext, @Body(new ZodPipe(extensionLookupSchema)) body: ExtensionLookupInput) {
    return this.extension.lookup(auth, body);
  }

  @Post('capture')
  @HttpCode(200)
  @RequirePermissions('leads:write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  capture(@Auth() auth: AuthContext, @Body(new ZodPipe(extensionCaptureSchema)) body: ExtensionCaptureInput, @Meta() meta: RequestMeta) {
    return this.extension.capture(auth, body, meta);
  }
}
