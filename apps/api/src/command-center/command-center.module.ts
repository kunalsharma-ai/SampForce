import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { CommandCenterController } from './command-center.controller';
import { CommandCenterService } from './command-center.service';
import { ManagerDashboardService } from './manager.service';
import { SeniorDashboardService } from './senior.service';

@Module({
  imports: [CrmModule],
  controllers: [CommandCenterController],
  providers: [CommandCenterService, ManagerDashboardService, SeniorDashboardService],
  exports: [CommandCenterService],
})
export class CommandCenterModule {}
