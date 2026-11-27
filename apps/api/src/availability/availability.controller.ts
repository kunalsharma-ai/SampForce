import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { availabilityStatusSchema, type AvailabilityStatusInput, availabilityTeamQuerySchema } from '@dealflow/types';
import { Auth, type AuthContext } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { AvailabilityService } from './availability.service';

/**
 * Working status (ADR 0081): every signed-in person checks in, takes breaks and checks out for themself only. Like
 * notifications it is part of every plan and every workspace level, so it has no plan feature.
 */
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.availability.me(auth);
  }

  @Post('beat')
  @HttpCode(200)
  beat(@Auth() auth: AuthContext) {
    return this.availability.beat(auth);
  }

  @Post('check-in')
  @HttpCode(200)
  checkIn(@Auth() auth: AuthContext) {
    return this.availability.checkIn(auth);
  }

  @Post('break')
  @HttpCode(200)
  startBreak(@Auth() auth: AuthContext) {
    return this.availability.startBreak(auth);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@Auth() auth: AuthContext) {
    return this.availability.resume(auth);
  }

  @Post('check-out')
  @HttpCode(200)
  checkOut(@Auth() auth: AuthContext) {
    return this.availability.checkOut(auth);
  }

  @Put('status')
  status(@Auth() auth: AuthContext, @Body(new ZodPipe(availabilityStatusSchema)) body: AvailabilityStatusInput) {
    return this.availability.setStatus(auth, body.status);
  }

  @Get('team')
  team(@Auth() auth: AuthContext, @Query(new ZodPipe(availabilityTeamQuerySchema)) q: { workspaceId?: string }) {
    return this.availability.team(auth, q.workspaceId);
  }
}
