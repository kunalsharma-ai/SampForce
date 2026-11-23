import { Module } from '@nestjs/common';
import { MobileModule } from '../mobile/mobile.module';
import { ProfilePhotosController } from './profile-photos.controller';
import { ProfilePhotosService } from './profile-photos.service';

/** Profile photos (ADR 0072, M6). */
@Module({
  imports: [MobileModule],
  controllers: [ProfilePhotosController],
  providers: [ProfilePhotosService],
  exports: [ProfilePhotosService],
})
export class ProfilePhotosModule {}
