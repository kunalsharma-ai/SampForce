import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { type AchievementListQuery, achievementListQuerySchema, type AchievementSettingsInput, achievementSettingsSchema } from '@dealflow/types';
import { Auth, type AuthContext } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AchievementsService } from './achievements.service';

/**
 * My Achievements and celebrations (ADR 0090). Everyone sees only their own achievements and settings. Like working
 * status and notifications it is part of every plan and every workspace level, so it has no plan feature.
 */
@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(achievementListQuerySchema)) q: AchievementListQuery) {
    return this.achievements.list(auth, q);
  }

  /** Takes the achievements waiting for their pop-up; each is handed out once. */
  @Post('claim')
  @HttpCode(200)
  claim(@Auth() auth: AuthContext) {
    return this.achievements.claim(auth);
  }

  @Get('summary')
  summary(@Auth() auth: AuthContext) {
    return this.achievements.summary(auth);
  }

  @Get('settings')
  settings(@Auth() auth: AuthContext) {
    return this.achievements.settings(auth);
  }

  @Put('settings')
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(achievementSettingsSchema)) body: AchievementSettingsInput) {
    return this.achievements.saveSettings(auth, body);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.achievements.get(auth, id);
  }
}
