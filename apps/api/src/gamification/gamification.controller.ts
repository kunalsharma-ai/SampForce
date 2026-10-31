import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { badgeInputSchema, competitionInputSchema, gamificationSettingsSchema, leaderboardQuerySchema, type z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { GamificationService } from './gamification.service';

const uuid = new ParseUUIDPipe();

/** Enhancement feature 14: points, leaderboards, badges, competitions and team challenges. */
@Controller('gamification')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Get('me')
  @RequirePermissions('gamification:read')
  me(@Auth() auth: AuthContext) {
    return this.gamification.me(auth);
  }

  @Get('leaderboard')
  @RequirePermissions('gamification:read')
  leaderboard(@Auth() auth: AuthContext, @Query(new ZodPipe(leaderboardQuerySchema)) q: z.infer<typeof leaderboardQuerySchema>) {
    return this.gamification.leaderboard(auth, q.period);
  }

  @Get('settings')
  @RequirePermissions('gamification:read')
  settings(@Auth() auth: AuthContext) {
    return this.gamification.settings(auth);
  }

  @Put('settings')
  @RequirePermissions('gamification:manage')
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(gamificationSettingsSchema)) body: z.infer<typeof gamificationSettingsSchema>, @Meta() meta: RequestMeta) {
    return this.gamification.saveSettings(auth, body, meta);
  }

  @Get('badges')
  @RequirePermissions('gamification:read')
  badges(@Auth() auth: AuthContext) {
    return this.gamification.badges(auth);
  }

  @Post('badges')
  @RequirePermissions('gamification:manage')
  createBadge(@Auth() auth: AuthContext, @Body(new ZodPipe(badgeInputSchema)) body: z.infer<typeof badgeInputSchema>, @Meta() meta: RequestMeta) {
    return this.gamification.createBadge(auth, body, meta);
  }

  @Post('badges/defaults')
  @RequirePermissions('gamification:manage')
  addDefaultBadges(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.gamification.addDefaultBadges(auth, meta);
  }

  @Post('badges/evaluate')
  @HttpCode(200)
  @RequirePermissions('gamification:manage')
  evaluate(@Auth() auth: AuthContext) {
    return this.gamification.evaluateNow(auth);
  }

  @Put('badges/:id')
  @RequirePermissions('gamification:manage')
  updateBadge(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(badgeInputSchema)) body: z.infer<typeof badgeInputSchema>, @Meta() meta: RequestMeta) {
    return this.gamification.updateBadge(auth, id, body, meta);
  }

  @Delete('badges/:id')
  @HttpCode(204)
  @RequirePermissions('gamification:manage')
  removeBadge(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.gamification.removeBadge(auth, id, meta);
  }

  @Get('awards')
  @RequirePermissions('gamification:read')
  awards(@Auth() auth: AuthContext) {
    return this.gamification.awards(auth);
  }

  @Get('competitions')
  @RequirePermissions('gamification:read')
  competitions(@Auth() auth: AuthContext) {
    return this.gamification.competitions(auth);
  }

  @Post('competitions')
  @RequirePermissions('gamification:manage')
  createCompetition(@Auth() auth: AuthContext, @Body(new ZodPipe(competitionInputSchema)) body: z.infer<typeof competitionInputSchema>, @Meta() meta: RequestMeta) {
    return this.gamification.createCompetition(auth, body, meta);
  }

  @Post('competitions/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('gamification:manage')
  cancelCompetition(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.gamification.cancelCompetition(auth, id, meta);
  }
}
