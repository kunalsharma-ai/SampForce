import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { FormsService } from './forms.service';
import { CampaignsController, FormsController, PublicFormsController, SegmentsController } from './marketing.controller';
import { SegmentsService } from './segments.service';

@Module({
  controllers: [SegmentsController, FormsController, PublicFormsController, CampaignsController],
  providers: [SegmentsService, FormsService, CampaignsService],
})
export class MarketingModule {}
