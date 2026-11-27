import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module';
import { CrmAdminController } from './crm-admin.controller';
import { CrmAdminService } from './crm-admin.service';
import { CrmConfigController } from './crm-config.controller';
import { CrmConfigService } from './crm-config.service';
import { ActivitiesService } from './activities.service';
import { CompaniesService } from './companies.service';
import { CompanyFilesController, CompanyLeadPartsController, CompanyLeadsController, EmployeeStatsController } from './company-leads.controller';
import { CompanyLeadsService } from './company-leads.service';
import { CompanyLogosController } from './company-logos.controller';
import { CompanyLogosService } from './company-logos.service';
import { CompanyAutofillPreviewController, CompanyEnrichmentController } from './company-enrichment.controller';
import { HunterClient } from '../finder/hunter';
import { CompanyEnrichmentService } from './company-enrichment.service';
import { CompanyDashboardController, FollowUpsController, InteractionsController, RfqsController } from './company-work.controller';
import { CompanyWorkService } from './company-work.service';
import { EmployeeStagesController } from './employee-stages.controller';
import { EmployeeStagesService } from './employee-stages.service';
import { FollowUpCadenceService } from './follow-up-cadence.service';
import { CompanyDealsController } from './company-deals.controller';
import { CompanyDealsService } from './company-deals.service';
import { JourneyController } from './journey.controller';
import { JourneyService } from './journey.service';
import { FollowUpCadenceController } from './follow-up-cadence.controller';
import { FirstEmailService } from './first-email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContactsService } from './contacts.service';
import { CustomFieldsService } from './custom-fields.service';
import { DealsController, PipelinesController, TerritoriesController } from './deals.controller';
import { DealsService } from './deals.service';
import { ClientConcernsController, InstructionsController, LeadTransfersController, RevenueRecordsController } from './command-center.controller';
import { ClientConcernsService } from './client-concerns.service';
import { InstructionsService } from './instructions.service';
import { LeadTransfersService } from './lead-transfers.service';
import { RevenueRecordsService } from './revenue-records.service';
import { ImportExportService } from './import-export.service';
import { CompanyExportService } from './company-export.service';
import { ImportService } from './import.service';
import { LeadsService } from './leads.service';
import { PipelinesService } from './pipelines.service';
import { CompaniesController, ContactsController, LeadsController } from './records.controller';
import { SearchService } from './search.service';
import { TasksService } from './tasks.service';
import { TerritoriesService } from './territories.service';
import {
  ActivitiesController,
  CustomFieldsController,
  ImportExportController,
  SearchController,
  TasksController,
} from './work.controller';

@Module({
  imports: [GeoModule],
  controllers: [
    JourneyController,
    CompanyDealsController,
    EmployeeStagesController,
    FollowUpCadenceController,
    LeadsController,
    ContactsController,
    CompaniesController,
    DealsController,
    PipelinesController,
    TerritoriesController,
    ActivitiesController,
    TasksController,
    SearchController,
    CustomFieldsController,
    ImportExportController,
    CrmConfigController,
    CrmAdminController,
    CompanyLeadsController,
    CompanyDashboardController,
    InteractionsController,
    FollowUpsController,
    RfqsController,
    CompanyLeadPartsController,
    CompanyLogosController,
    CompanyAutofillPreviewController,
    CompanyEnrichmentController,
    CompanyFilesController,
    EmployeeStatsController,
    RevenueRecordsController,
    LeadTransfersController,
    InstructionsController,
    ClientConcernsController,
  ],
  providers: [
    FirstEmailService,
    CustomFieldsService,
    CrmAdminService,
    CompaniesService,
    CompanyDealsService,
    JourneyService,
    ContactsService,
    LeadsService,
    DealsService,
    PipelinesService,
    ActivitiesService,
    TasksService,
    SearchService,
    ImportExportService,
    CompanyExportService,
    ImportService,
    TerritoriesService,
    CrmConfigService,
    CompanyLeadsService,
    CompanyLogosService,
    CompanyEnrichmentService,
    HunterClient,
    CompanyWorkService,
    EmployeeStagesService,
    FollowUpCadenceService,
    NotificationsService,
    RevenueRecordsService,
    LeadTransfersService,
    InstructionsService,
    ClientConcernsService,
  ],
  exports: [EmployeeStagesService, FollowUpCadenceService, CrmConfigService, CompanyLeadsService, CompanyLogosService, CompanyEnrichmentService, RevenueRecordsService, LeadTransfersService, InstructionsService, ClientConcernsService, CompanyWorkService, CompaniesService, CompanyDealsService, ContactsService, LeadsService, DealsService, ActivitiesService, TasksService, SearchService, PipelinesService, CrmAdminService, CustomFieldsService],
})
export class CrmModule {}
