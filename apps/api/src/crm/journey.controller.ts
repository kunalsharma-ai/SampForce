import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { type JourneyBoardQuery, journeyBoardQuerySchema, journeySettingsSchema, type JourneySettingsInput } from '@dealflow/types';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { JourneyService } from './journey.service';

const uuid = new ParseUUIDPipe();

/** The company journey and the Pipeline journey board (redesign R5, ADR 0085). */
@Controller()
@ApiKeyAccess()
export class JourneyController {
  constructor(private readonly journey: JourneyService) {}

  @Get('pipeline/journey')
  @RequirePermissions('companies:read')
  board(@Auth() auth: AuthContext, @Query(new ZodPipe(journeyBoardQuerySchema)) q: JourneyBoardQuery) {
    return this.journey.board(auth, q);
  }

  @Get('companies/:id/journey')
  @RequirePermissions('companies:read')
  company(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.journey.companyJourney(auth, id);
  }

  /** Everyone reads the stage names; only the Super Workspace changes them. */
  @Get('crm-config/journey')
  @RequirePermissions('companies:read')
  settings(@Auth() auth: AuthContext) {
    return this.journey.settings(auth);
  }

  @Put('crm-config/journey')
  @RequirePermissions('crm:configure')
  setSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(journeySettingsSchema)) body: JourneySettingsInput, @Meta() meta: RequestMeta) {
    return this.journey.setSettings(auth, body, meta);
  }
}
