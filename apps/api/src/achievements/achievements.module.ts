import { Global, Module } from '@nestjs/common';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

/** Achievements and celebrations (ADR 0090). Global, so the RFQ and check-out steps can report confirmed facts. */
@Global()
@Module({ controllers: [AchievementsController], providers: [AchievementsService], exports: [AchievementsService] })
export class AchievementsModule {}
