import { Module } from '@nestjs/common';
import { ExtensionModule } from '../extension/extension.module';
import { ExtensionFinderController, FinderController } from './finder.controller';
import { FinderService } from './finder.service';
import { HunterClient } from './hunter';
import { FinderNet } from './net';

/** Phase 9: the email finder (own website reader plus an optional Hunter.io key). */
@Module({
  imports: [ExtensionModule],
  controllers: [FinderController, ExtensionFinderController],
  providers: [FinderService, FinderNet, HunterClient],
})
export class FinderModule {}
