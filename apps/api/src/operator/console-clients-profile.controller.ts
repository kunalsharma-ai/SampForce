import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  type ConsoleCityAddInput,
  consoleCityAddSchema,
  consoleCityQuerySchema,
  type ConsoleCityRenameInput,
  consoleCityRenameSchema,
  type ConsoleClientProfileInput,
  consoleClientProfileSchema,
  type z,
} from '@dealflow/types';
import type { Request, Response } from 'express';
import { Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { GeoService } from '../geo/geo.service';
import { ConsoleClientsProfileService, readLogoUpload } from './console-clients-profile.service';
import { Operator, OperatorAny, type OperatorContext, OperatorGuard, OperatorPermission } from './operator-auth';

const ip = (req: Request) => req.ip ?? null;

/** The client profile, its logo and the Locations page (ADR 0074, C4). */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class ConsoleClientsProfileController {
  constructor(
    private readonly profiles: ConsoleClientsProfileService,
    private readonly geo: GeoService,
  ) {}

  @Patch('clients/:id/profile')
  @OperatorPermission('clients.edit')
  profile(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(consoleClientProfileSchema)) body: ConsoleClientProfileInput, @Req() req: Request) {
    return this.profiles.updateProfile(op, id, body, ip(req));
  }

  /** Sets the client's logo: the image is the raw request body (PNG, JPEG or WebP, up to 2 MB), cropped in the browser. */
  @Put('clients/:id/logo')
  @OperatorPermission('clients.edit')
  async setLogo(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.profiles.setLogo(op, id, await readLogoUpload(req), ip(req));
  }

  @Delete('clients/:id/logo')
  @OperatorPermission('clients.edit')
  removeLogo(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.profiles.removeLogo(op, id, ip(req));
  }

  /** The logo image. Its URL carries a version, so it may be kept; it can never run as a page. */
  @Get('clients/:id/logo')
  @OperatorAny()
  async logo(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const logo = await this.profiles.logo(id);
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Content-Disposition', 'inline; filename="logo"');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(logo.data);
  }

  // ───── Locations: the same lists the workspace pickers use, with the Console's own city changes ─────

  @Get('locations/:country/regions')
  @OperatorAny()
  regions(@Param('country') country: string) {
    return this.geo.regions(country);
  }

  @Get('locations/:country/cities')
  @OperatorAny()
  cities(@Param('country') country: string, @Query(new ZodPipe(consoleCityQuerySchema)) q: z.infer<typeof consoleCityQuerySchema>) {
    return this.profiles.cities(country, q);
  }

  @Get('locations/:country/changes')
  @OperatorPermission('settings.manage')
  changes(@Param('country') country: string) {
    return this.profiles.edits(country);
  }

  @Post('locations/cities')
  @OperatorPermission('settings.manage')
  addCity(@Operator() op: OperatorContext, @Body(new ZodPipe(consoleCityAddSchema)) body: ConsoleCityAddInput, @Req() req: Request) {
    return this.profiles.addCity(op, body, ip(req));
  }

  @Post('locations/cities/rename')
  @OperatorPermission('settings.manage')
  renameCity(@Operator() op: OperatorContext, @Body(new ZodPipe(consoleCityRenameSchema)) body: ConsoleCityRenameInput, @Req() req: Request) {
    return this.profiles.renameCity(op, body, ip(req));
  }

  @Delete('locations/cities/:id')
  @OperatorPermission('settings.manage')
  undoCity(@Operator() op: OperatorContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.profiles.undoCity(op, id, ip(req));
  }
}
