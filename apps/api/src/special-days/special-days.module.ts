import { Module } from '@nestjs/common';
import { OperatorModule } from '../operator/operator.module';
import { ConsoleSpecialDaysController, SpecialDaysController } from './special-days.controller';
import { SpecialDaysService } from './special-days.service';

@Module({
  imports: [OperatorModule],
  controllers: [SpecialDaysController, ConsoleSpecialDaysController],
  providers: [SpecialDaysService],
})
export class SpecialDaysModule {}
