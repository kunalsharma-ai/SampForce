import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, MfaService],
  exports: [TokenService, PasswordService, AuthService, MfaService],
})
export class AuthModule {}
