import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { SequencesModule } from '../sequences/sequences.module';
import { ExtensionConnectionsController, ExtensionController } from './extension.controller';
import { ExtensionService } from './extension.service';

/** Phase 9: the browser extension's connections and lead capture. */
@Module({
  imports: [CrmModule, SequencesModule],
  controllers: [ExtensionConnectionsController, ExtensionController],
  providers: [ExtensionService],
  exports: [ExtensionService],
})
export class ExtensionModule {}
