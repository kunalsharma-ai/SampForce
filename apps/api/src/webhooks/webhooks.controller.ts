import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { type DomainEventType, webhookInputSchema, z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { WebhooksService } from './webhooks.service';

const updateSchema = webhookInputSchema.partial().extend({ active: z.boolean().optional() });

@Controller('webhooks')
@RequireFeature('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermissions('integrations:manage')
  list(@Auth() auth: AuthContext) {
    return this.webhooks.list(auth);
  }

  @Post()
  @RequirePermissions('integrations:manage')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(webhookInputSchema)) body: { url: string; events: DomainEventType[] }, @Meta() meta: RequestMeta) {
    return this.webhooks.create(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermissions('integrations:manage')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @Meta() meta: RequestMeta,
  ) {
    return this.webhooks.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('integrations:manage')
  remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.webhooks.remove(auth, id, meta);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  @HttpCode(202)
  @RequirePermissions('integrations:manage')
  redeliver(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('deliveryId', ParseUUIDPipe) deliveryId: string) {
    return this.webhooks.redeliver(auth, id, deliveryId);
  }
}
