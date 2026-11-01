import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { BulkActionsController, ViewsController } from './views.controller';
import { BulkActionsService, ViewsService } from './views.service';

/** Saved table views and bulk row actions (ADR 0042). */
@Module({ imports: [CrmModule], controllers: [ViewsController, BulkActionsController], providers: [ViewsService, BulkActionsService] })
export class ViewsModule {}
