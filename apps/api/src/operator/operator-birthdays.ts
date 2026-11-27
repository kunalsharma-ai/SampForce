import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { birthdaysQuery, type TodayBirthdays } from '@dealflow/types';
import { Public } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { birthdaysOn } from '../profile-photos/profiles.service';
import { Operator, OperatorAny, type OperatorContext, OperatorGuard } from './operator-auth';
import { OperatorPhotosService } from './operator-photos';

/**
 * Birthdays in the Console (ADR 0087): operators whose SampForce account (the same email) has a birthday today and
 * shares it, for the Overview's celebration. Operators have no profile of their own, so the date comes from there.
 */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class OperatorBirthdaysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: OperatorPhotosService,
  ) {}

  @Get('birthdays')
  @OperatorAny()
  async today(@Operator() me: OperatorContext, @Query(new ZodPipe(birthdaysQuery)) q: { date: string }): Promise<TodayBirthdays> {
    const ops = await this.prisma.platformOperator.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, email: true } });
    if (!ops.length) return { date: q.date, people: [] };
    const users = await this.prisma.user.findMany({
      where: { email: { in: ops.map((o) => o.email.toLowerCase()) }, profile: { is: { birthDay: { not: null } } } },
      select: { email: true, profile: true },
    });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.profile]));
    const withDates = ops.filter((o) => byEmail.has(o.email.toLowerCase()));
    const photos = await this.photos.urls(withDates);
    const people = withDates.map((o) => ({ id: o.id, name: o.name, photoUrl: photos.get(o.id) ?? null, profile: byEmail.get(o.email.toLowerCase()) ?? null }));
    return { date: q.date, people: birthdaysOn(people, q.date, me.id) };
  }
}
