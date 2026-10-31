import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SecurityController, SsoController } from './identity.controller';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';
import { SecurityService } from './security.service';
import { SsoService } from './sso.service';

/** Workspace identity: security security policy, OpenID Connect single sign-on and SCIM 2.0 provisioning. */
@Module({
  imports: [AuthModule],
  controllers: [SsoController, SecurityController, ScimController],
  providers: [SecurityService, SsoService, ScimService],
})
export class IdentityModule {}
