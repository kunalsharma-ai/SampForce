import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { type Appearance, appearanceSchema, type SavedThemeInput, savedThemeInputSchema } from '@dealflow/types';
import { AllowRestricted, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PreferencesService } from './preferences.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/** The signed-in person's own interface settings and saved themes. Needs no workspace permission. */
@Controller('me')
export class PreferencesController {
  constructor(private readonly prefs: PreferencesService) {}

  /** Readable while a security policy restricts the session, so the policy screen still uses the person's theme. */
  @AllowRestricted()
  @Get('preferences')
  get(@Auth() auth: AuthContext) {
    return this.prefs.get(auth);
  }

  @Put('preferences/appearance')
  save(@Auth() auth: AuthContext, @Body(new ZodPipe(appearanceSchema)) body: Appearance) {
    return this.prefs.save(auth, body);
  }

  @Delete('preferences/appearance')
  reset(@Auth() auth: AuthContext) {
    return this.prefs.reset(auth);
  }

  @Get('themes')
  listThemes(@Auth() auth: AuthContext) {
    return this.prefs.listThemes(auth);
  }

  @Post('themes')
  saveTheme(@Auth() auth: AuthContext, @Body(new ZodPipe(savedThemeInputSchema)) body: SavedThemeInput) {
    return this.prefs.saveTheme(auth, body);
  }

  @Delete('themes/:id')
  @HttpCode(204)
  deleteTheme(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.prefs.deleteTheme(auth, id);
  }
}

/** The workspace default appearance, for members who have not chosen their own. */
@Controller('tenants/current/appearance')
export class WorkspaceAppearanceController {
  constructor(private readonly prefs: PreferencesService) {}

  @Put()
  @RequirePermissions('tenant:manage')
  set(@Auth() auth: AuthContext, @Body(new ZodPipe(appearanceSchema)) body: Appearance, @Meta() meta: RequestMeta) {
    return this.prefs.setWorkspaceDefault(auth, body, meta);
  }

  @Delete()
  @RequirePermissions('tenant:manage')
  clear(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.prefs.setWorkspaceDefault(auth, null, meta);
  }
}
