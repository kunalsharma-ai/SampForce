import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OperatorModule } from '../operator/operator.module';
import { MobileAccessService } from './mobile-access.service';
import { MobileAuthService } from './mobile-auth.service';
import { MobileConfigService } from './mobile-config.service';
import { MobileAccessController, MobileAuthController, MobileConfigController, MobileSessionController, OperatorMobileController } from './mobile.controller';

/** The SampForce mobile app (ADR 0072): Console approval, Super Workspace activation, phone sign-in and sessions. */
@Module({
  imports: [AuthModule, OperatorModule],
  controllers: [MobileAuthController, MobileSessionController, MobileAccessController, MobileConfigController, OperatorMobileController],
  providers: [MobileAccessService, MobileAuthService, MobileConfigService],
  exports: [MobileAccessService, MobileAuthService, MobileConfigService],
})
export class MobileModule {}
