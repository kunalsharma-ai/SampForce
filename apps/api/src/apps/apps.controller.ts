import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { APP_FEATURES, type AppKey, type FeatureKey, z } from '@dealflow/types';
import { Auth, type AuthContext, type AuthedRequest, Meta, type RequestMeta, RequireFeature, RequirePermissions } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { AppsService } from './apps.service';
import { ConfirmPassword } from '../common/password-confirmation';

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

  @ConfirmPassword()
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
}
