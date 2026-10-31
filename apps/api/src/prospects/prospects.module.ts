import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { ExtensionModule } from '../extension/extension.module';
import { HunterClient } from '../finder/hunter';
import { NotificationsService } from '../notifications/notifications.service';
import { SequencesModule } from '../sequences/sequences.module';
import { ApolloClient } from './apollo';
import { ExtensionProspectsController, ProspectListsController, ProspectsController } from './prospects.controller';
import { ProspectsService } from './prospects.service';

/** Part 2: Prospect Lists and prospect discovery (Apollo.io search, Hunter.io verification, Mock Mode without keys). */
@Module({
  imports: [CrmModule, SequencesModule, ExtensionModule],
  controllers: [ProspectListsController, ProspectsController, ExtensionProspectsController],
  providers: [ProspectsService, ApolloClient, HunterClient, NotificationsService],
  exports: [ProspectsService],
})
export class ProspectsModule {}
