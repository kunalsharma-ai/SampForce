import { Global, Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PipsService } from './pips.service';
import { PipsController, RecognitionController } from './recognition.controller';
import { RecognitionService } from './recognition.service';

/** Employee of the Month and improvement plans (ADR 0102). Global, so the worker can run their sweeps. */
@Global()
@Module({
  controllers: [RecognitionController, PipsController],
  providers: [RecognitionService, PipsService, NotificationsService],
  exports: [RecognitionService, PipsService],
})
export class RecognitionModule {}
