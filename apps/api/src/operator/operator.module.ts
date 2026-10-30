import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OperatorGuard, OperatorTokens } from './operator-auth';
import { OperatorController } from './operator.controller';
import { OperatorService } from './operator.service';

/** The platform operator console's API, a separate realm from workspace sign-in. */
@Module({ imports: [AuthModule], controllers: [OperatorController], providers: [OperatorService, OperatorTokens, OperatorGuard] })
export class OperatorModule {}
