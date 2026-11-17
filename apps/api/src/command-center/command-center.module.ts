import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { CommandCenterController } from './command-center.controller';
import { CommandCenterService } from './command-center.service';
import { ManagerDashboardService } from './manager.service';

@Module({
  imports: [CrmModule],
  controllers: [CommandCenterController],
  providers: [CommandCenterService, ManagerDashboardService],
  exports: [CommandCenterService],
})
export class CommandCenterModule {}
