import { Module } from '@nestjs/common';
import { CrmModule } from '../../crm/crm.module';
import { MobileModule } from '../mobile.module';
import { MobileRecordsController } from './mobile-records.controller';
import { MobileRecordsService } from './mobile-records.service';

/** Records on the phone (ADR 0072, M4). */
@Module({
  imports: [CrmModule, MobileModule],
  controllers: [MobileRecordsController],
  providers: [MobileRecordsService],
})
export class MobileRecordsModule {}
