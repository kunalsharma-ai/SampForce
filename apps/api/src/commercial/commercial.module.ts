import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { CatalogService } from './catalog.service';
import { CatalogController, ContractsController, PublicProposalsController, QuotesController } from './commercial.controller';
import { ContractsService } from './contracts.service';
import { ProposalsService } from './proposals.service';
import { QuotesService } from './quotes.service';

@Module({
  imports: [AutomationModule],
  controllers: [CatalogController, QuotesController, ContractsController, PublicProposalsController],
  providers: [CatalogService, QuotesService, ContractsService, ProposalsService],
  exports: [QuotesService, ContractsService, ProposalsService],
})
export class CommercialModule {}
