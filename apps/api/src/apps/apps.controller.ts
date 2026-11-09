import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { APP_FEATURES, type AppKey, type FeatureKey, type SlackSettings, slackSettingsSchema, slackTestSchema, type TeamsAddChannelInput, teamsAddChannelSchema, teamsChannelId, teamsSettingsSchema, teamsTestSchema, z } from '@dealflow/types';
import { Auth, type AuthContext, type AuthedRequest, Meta, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { AppError, AppsService } from './apps.service';

/** The plan feature each workspace app belongs to (ADR 0057). */
const appFeature = (req: AuthedRequest): FeatureKey | null => {
  // Disconnecting always works, so a workspace that lost an app with its plan can still remove the connection.
  if (req.method === 'DELETE' && /\/apps\/[a-z]+\/?$/.test(req.path)) return null;
  const app = (req.params as Record<string, string | undefined>).app ?? req.path.split('/apps/')[1]?.split('/')[0];
  return app && app in APP_FEATURES ? APP_FEATURES[app as AppKey] : null;
};

const callbackQuery = z.object({ code: z.string().max(4000).optional(), state: z.string().max(4000).optional(), error: z.string().max(200).optional() });

/** Workspace apps: anyone can see what is connected; admins connect, configure and disconnect. */
@Controller('apps')
@RequireFeature(appFeature)
export class AppsController {
  constructor(
    private readonly apps: AppsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get()
  status(@Auth() auth: AuthContext) {
    return this.apps.status(auth);
  }

  @Post(':app/connect')
  @HttpCode(200)
  @RequirePermissions('integrations:manage')
  connect(@Auth() auth: AuthContext, @Param('app') app: string) {
    return this.apps.connectUrl(auth, AppsService.parseApp(app));
  }

  /** OAuth redirect target. Always lands back on the Integrations page with an outcome. */
  @Get(':app/callback')
  @RequirePermissions('integrations:manage')
  async callback(@Auth() auth: AuthContext, @Param('app') raw: string, @Query(new ZodPipe(callbackQuery)) q: z.infer<typeof callbackQuery>, @Meta() meta: RequestMeta, @Res() res: Response): Promise<void> {
    const back = `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/app/integrations`;
    const app = AppsService.parseApp(raw);
    if (q.error || !q.code || !q.state) {
      res.redirect(302, `${back}?app=${app}&app_error=${encodeURIComponent(q.error ?? 'missing_code')}`);
      return;
    }
    try {
      await this.apps.completeConnect(auth, app, q.code, q.state, meta);
      res.redirect(302, `${back}?app=${app}&app_connected=1`);
    } catch (err) {
      const code = (err as { response?: { code?: string } }).response?.code ?? (err as { code?: string }).code ?? 'connect_failed';
      res.redirect(302, `${back}?app=${app}&app_error=${encodeURIComponent(String(code).toLowerCase())}`);
    }
  }

  @Delete(':app')
  @HttpCode(204)
  @RequirePermissions('integrations:manage')
  disconnect(@Auth() auth: AuthContext, @Param('app') app: string, @Meta() meta: RequestMeta) {
    return this.apps.disconnect(auth, AppsService.parseApp(app), meta);
  }

  @Get(':app/events')
  @RequirePermissions('integrations:manage')
  events(@Auth() auth: AuthContext, @Param('app') app: string) {
    return this.apps.events(auth, AppsService.parseApp(app));
  }

  @Get('slack/channels')
  @RequirePermissions('automation:manage')
  channels(@Auth() auth: AuthContext) {
    return this.wrap(() => this.apps.slackChannels(auth));
  }

  @Put('slack/settings')
  @RequirePermissions('integrations:manage')
  settings(@Auth() auth: AuthContext, @Body(new ZodPipe(slackSettingsSchema)) body: SlackSettings, @Meta() meta: RequestMeta) {
    return this.wrap(() => this.apps.slackSettings(auth, body, meta));
  }

  /** Posts a short test message so an admin can see the connection work. */
  @Post('slack/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('integrations:manage')
  test(@Auth() auth: AuthContext, @Body(new ZodPipe(slackTestSchema)) body: z.infer<typeof slackTestSchema>) {
    return this.wrap(() =>
      this.apps.postToSlack(auth.tenantId, { channelId: body.channelId ?? null, text: 'SampForce is connected. Workflow messages will appear here.', actorUserId: auth.userId, source: 'test message' }),
    );
  }

  // ───── Microsoft Teams ─────

  /** Channels added for Teams, without their URLs (workflow editors pick from these). */
  @Get('teams/channels')
  @RequirePermissions('automation:manage')
  async teamsChannels(@Auth() auth: AuthContext) {
    const s = (await this.apps.status(auth)).find((a) => a.key === 'teams')!;
    return (s.connection?.settings as { channels?: unknown[] } | undefined)?.channels ?? [];
  }

  /** Adds a channel by its Teams Workflows URL; Teams must accept a welcome card first. */
  @Post('teams/channels')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('integrations:manage')
  teamsAdd(@Auth() auth: AuthContext, @Body(new ZodPipe(teamsAddChannelSchema)) body: TeamsAddChannelInput, @Meta() meta: RequestMeta) {
    return this.wrap(() => this.apps.teamsAddChannel(auth, body, meta));
  }

  @Delete('teams/channels/:id')
  @RequirePermissions('integrations:manage')
  teamsRemove(@Auth() auth: AuthContext, @Param('id', new ZodPipe(teamsChannelId)) id: string, @Meta() meta: RequestMeta) {
    return this.wrap(() => this.apps.teamsRemoveChannel(auth, id, meta));
  }

  @Put('teams/settings')
  @RequirePermissions('integrations:manage')
  teamsSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(teamsSettingsSchema)) body: z.infer<typeof teamsSettingsSchema>, @Meta() meta: RequestMeta) {
    return this.wrap(() => this.apps.teamsDefault(auth, body.defaultChannelId, meta));
  }

  @Post('teams/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('integrations:manage')
  teamsTest(@Auth() auth: AuthContext, @Body(new ZodPipe(teamsTestSchema)) body: z.infer<typeof teamsTestSchema>) {
    return this.wrap(() =>
      this.apps.postToTeams(auth.tenantId, { channelId: body.channelId ?? null, message: { text: 'SampForce test message. Workflow updates will appear here.', link: null }, actorUserId: auth.userId, source: 'test message' }),
    );
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AppError) throw new BadRequestException({ code: 'APP_ERROR', message: e.message });
      throw e;
    }
  }
}
