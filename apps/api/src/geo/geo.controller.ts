import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { GEO_COUNTRIES, z } from '@dealflow/types';
import { ZodPipe } from '../common/zod.pipe';
import { GeoService } from './geo.service';

export const citiesQuery = z.object({
  region: z.string().trim().max(10).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Country, region and city lists for every signed-in person (reference data, the same for every workspace). */
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('countries')
  @Header('Cache-Control', 'private, max-age=86400')
  countries() {
    return GEO_COUNTRIES;
  }

  @Get('countries/:code/regions')
  @Header('Cache-Control', 'private, max-age=86400')
  regions(@Param('code') code: string) {
    return this.geo.regions(code);
  }

  @Get('countries/:code/cities')
  @Header('Cache-Control', 'private, max-age=3600')
  cities(@Param('code') code: string, @Query(new ZodPipe(citiesQuery)) q: z.infer<typeof citiesQuery>) {
    return this.geo.cities(code, q);
  }
}
