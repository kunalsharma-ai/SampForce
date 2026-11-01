import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type BulkActionInput,
  bulkActionSchema,
  type SavedViewInput,
  savedViewInputSchema,
  type SavedViewUpdate,
  savedViewUpdateSchema,
  TABLE_ENTITIES,
  type TableEntity,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { BulkActionsService, ViewsService } from './views.service';

const uuid = new ParseUUIDPipe();
const entityQuery = z.object({ entity: z.enum(TABLE_ENTITIES) }).strict();

/** Saved data table views. Reading a list's views needs no extra permission: they hold layout, not records. */
@Controller('views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(entityQuery)) q: { entity: TableEntity }) {
    return this.views.list(auth, q.entity);
  }

  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(savedViewInputSchema)) body: SavedViewInput) {
    return this.views.create(auth, body);
  }

  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(savedViewUpdateSchema)) body: SavedViewUpdate) {
    return this.views.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.views.remove(auth, id);
  }
}

/** Bulk actions on selected table rows; the service checks `<entity>:write`. */
@Controller('records/bulk')
export class BulkActionsController {
  constructor(private readonly bulk: BulkActionsService) {}

  @Post()
  @HttpCode(200)
  run(@Auth() auth: AuthContext, @Body(new ZodPipe(bulkActionSchema)) body: BulkActionInput, @Meta() meta: RequestMeta) {
    return this.bulk.run(auth, body, meta);
  }
}
