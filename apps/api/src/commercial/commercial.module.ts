import { Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { CatalogService } from './catalog.service';
import { CatalogController, ContractsController, QuotesController } from './commercial.controller';
import { ContractsService } from './contracts.service';
import { QuotesService } from './quotes.service';

@Module({
  controllers: [CatalogController, QuotesController, ContractsController],
  providers: [CatalogService, QuotesService, ContractsService, NotificationsService],
  exports: [QuotesService, ContractsService],
})
export class CommercialModule {}
