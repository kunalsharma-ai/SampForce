import { Module } from '@nestjs/common';
import { MobileModule } from '../mobile/mobile.module';
import { ProfilePhotosController } from './profile-photos.controller';
import { ProfilePhotosService } from './profile-photos.service';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

/** Profile photos (ADR 0072, M6) and personal profiles with a mood (ADR 0087). */
@Module({
  imports: [MobileModule],
  controllers: [ProfilePhotosController, ProfilesController],
  providers: [ProfilePhotosService, ProfilesService],
  exports: [ProfilePhotosService, ProfilesService],
})
export class ProfilePhotosModule {}
