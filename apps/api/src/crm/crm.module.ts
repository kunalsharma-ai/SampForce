import { Module } from '@nestjs/common';
import { GeoController } from '../geo/geo.controller';
import { GeoService } from '../geo/geo.service';
import { CrmAdminController } from './crm-admin.controller';
import { CrmAdminService } from './crm-admin.service';
import { CrmConfigController } from './crm-config.controller';
import { CrmConfigService } from './crm-config.service';
import { ActivitiesService } from './activities.service';
import { CompaniesService } from './companies.service';
import { CompanyFilesController, CompanyLeadPartsController, CompanyLeadsController, EmployeeStatsController } from './company-leads.controller';
import { CompanyLeadsService } from './company-leads.service';
import { CompanyDashboardController, FollowUpsController, InteractionsController, RfqsController } from './company-work.controller';
import { CompanyWorkService } from './company-work.service';
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
  controllers: [
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
    GeoController,
    CompanyLeadsController,
    CompanyDashboardController,
    InteractionsController,
    FollowUpsController,
    RfqsController,
    CompanyLeadPartsController,
    CompanyFilesController,
    EmployeeStatsController,
    RevenueRecordsController,
    LeadTransfersController,
    InstructionsController,
    ClientConcernsController,
  ],
  providers: [
    CustomFieldsService,
    CrmAdminService,
    CompaniesService,
    ContactsService,
    LeadsService,
    DealsService,
    PipelinesService,
    ActivitiesService,
    TasksService,
    SearchService,
    ImportExportService,
    TerritoriesService,
    CrmConfigService,
    GeoService,
    CompanyLeadsService,
    CompanyWorkService,
    NotificationsService,
    RevenueRecordsService,
    LeadTransfersService,
    InstructionsService,
    ClientConcernsService,
  ],
  exports: [RevenueRecordsService, LeadTransfersService, InstructionsService, ClientConcernsService, CompanyWorkService, CompaniesService, ContactsService, LeadsService, DealsService, ActivitiesService, TasksService, SearchService, PipelinesService, CrmAdminService, CustomFieldsService],
})
export class CrmModule {}
