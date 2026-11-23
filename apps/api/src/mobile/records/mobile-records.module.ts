import { Module } from '@nestjs/common';
import { CrmModule } from '../../crm/crm.module';
import { WorkspaceWorkModule } from '../../workspace-work/workspace-work.module';
import { MobileDashboardController } from '../dashboard/mobile-dashboard.controller';
import { MobileDashboardService } from '../dashboard/mobile-dashboard.service';
import { MobileModule } from '../mobile.module';
import { MobileRecordsController } from './mobile-records.controller';
import { MobileRecordsService } from './mobile-records.service';

/** Records (M4) and the home screen's figures and targets (M5) on the phone (ADR 0072). */
@Module({
  imports: [CrmModule, MobileModule, WorkspaceWorkModule],
  controllers: [MobileRecordsController, MobileDashboardController],
  providers: [MobileRecordsService, MobileDashboardService],
})
export class MobileRecordsModule {}
