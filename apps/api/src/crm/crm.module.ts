import { Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { CompaniesService } from './companies.service';
import { ContactsService } from './contacts.service';
import { CustomFieldsService } from './custom-fields.service';
import { DealsController, PipelinesController } from './deals.controller';
import { DealsService } from './deals.service';
import { ImportExportService } from './import-export.service';
import { LeadsService } from './leads.service';
import { PipelinesService } from './pipelines.service';
import { CompaniesController, ContactsController, LeadsController } from './records.controller';
import { SearchService } from './search.service';
import { TasksService } from './tasks.service';
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
    ActivitiesController,
    TasksController,
    SearchController,
    CustomFieldsController,
    ImportExportController,
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
  ],
})
export class CrmModule {}
