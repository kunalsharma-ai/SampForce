import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CrmModule } from '../crm/crm.module';
import { SequencesModule } from '../sequences/sequences.module';
import { ExtensionConnectionsController, ExtensionController } from './extension.controller';
import { ExtensionLoginController } from './extension-login.controller';
import { ExtensionService } from './extension.service';

/** Phase 9: the browser extension's connections and lead capture. */
@Module({
  imports: [AuthModule, CrmModule, SequencesModule],
  controllers: [ExtensionConnectionsController, ExtensionController, ExtensionLoginController],
  providers: [ExtensionService],
  exports: [ExtensionService],
})
export class ExtensionModule {}
