import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { moodSchema, myProfileSchema, type MoodInput, type MyProfileInput } from '@dealflow/types';
import { Auth, type AuthContext, Meta, MobileAccess, type RequestMeta } from '../common/auth-context';
import { NoPasswordConfirmation } from '../common/password-confirmation';
import { ZodPipe } from '../common/zod.pipe';
import { ProfilesService } from './profiles.service';

/** Personal profiles (ADR 0086): your own profile and mood, and your teammates' profiles. */
@MobileAccess()
@Controller()
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me/profile')
  mine(@Auth() auth: AuthContext) {
    return this.profiles.mine(auth);
  }

  @Put('me/profile')
  update(@Auth() auth: AuthContext, @Body(new ZodPipe(myProfileSchema)) body: MyProfileInput, @Meta() meta: RequestMeta) {
    return this.profiles.update(auth, body, meta);
  }

  @Put('me/mood')
  setMood(@Auth() auth: AuthContext, @Body(new ZodPipe(moodSchema)) body: MoodInput, @Meta() meta: RequestMeta) {
    return this.profiles.setMood(auth, body, meta);
  }

  @NoPasswordConfirmation('Your own mood; nothing else is lost')
  @Delete('me/mood')
  clearMood(@Auth() auth: AuthContext) {
    return this.profiles.clearMood(auth);
  }

  /** Everyone's photo, headline and mood in this workspace, for avatars. */
  @Get('people/cards')
  cards(@Auth() auth: AuthContext) {
    return this.profiles.cards(auth);
  }

  @Get('people/:id/profile')
  person(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.profiles.person(auth, id);
  }
}
