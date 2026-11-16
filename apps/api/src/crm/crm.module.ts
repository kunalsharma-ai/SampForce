import { Module } from '@nestjs/common';
import { GeoController } from '../geo/geo.controller';
import { GeoService } from '../geo/geo.service';
import { CrmConfigController } from './crm-config.controller';
import { CrmConfigService } from './crm-config.service';
import { ActivitiesService } from './activities.service';
import { CompaniesService } from './companies.service';
import { ContactsService } from './contacts.service';
import { CustomFieldsService } from './custom-fields.service';
import { DealsController, PipelinesController, TerritoriesController } from './deals.controller';
import { DealsService } from './deals.service';
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
    GeoController,
  ],
  providers: [
    CustomFieldsService,
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
  ],
  exports: [CompaniesService, ContactsService, LeadsService, DealsService, ActivitiesService, TasksService, SearchService, PipelinesService],
})
export class CrmModule {}
