import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MOOD_MAX_DAYS,
  PROFILE_COVERS,
  profileCompleteness,
  type MoodInput,
  type MyProfile,
  type MyProfileInput,
  type PersonCard,
  type PersonMood,
  type PersonProfile,
  type ProfileCover,
} from '@dealflow/types';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { photoUrl } from './profile-photos.service';

type ProfileRow = {
  headline: string | null;
  quote: string | null;
  bio: string | null;
  linkedinUrl: string | null;
  cover: string | null;
  tags: string[];
  moodEmoji: string | null;
  moodText: string | null;
  moodSetAt: Date | null;
  moodExpiresAt: Date | null;
};

/** The mood, unless it has cleared itself. */
export function liveMood(p: Pick<ProfileRow, 'moodEmoji' | 'moodText' | 'moodSetAt' | 'moodExpiresAt'> | null | undefined, now = new Date()): PersonMood | null {
  if (!p?.moodEmoji) return null;
  if (p.moodExpiresAt && p.moodExpiresAt <= now) return null;
  return { emoji: p.moodEmoji, text: p.moodText, setAt: (p.moodSetAt ?? now).toISOString(), expiresAt: p.moodExpiresAt?.toISOString() ?? null };
}

const coverOf = (c: string | null | undefined): ProfileCover => ((PROFILE_COVERS as readonly string[]).includes(c ?? '') ? (c as ProfileCover) : 'aurora');

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  photo: { select: { updatedAt: true } },
  profile: true,
} as const;

/**
 * Personal profiles (ADR 0086). Each person edits their own; people in the same organisation can read it, and see
 * everyone's photo, headline and mood on avatars across the app.
 */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async mine(auth: AuthContext): Promise<MyProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: userSelect });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found.' });
    const base = {
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      photoUrl: photoUrl(user.id, user.photo?.updatedAt),
      headline: user.profile?.headline ?? null,
      quote: user.profile?.quote ?? null,
      bio: user.profile?.bio ?? null,
      linkedinUrl: user.profile?.linkedinUrl ?? null,
      cover: coverOf(user.profile?.cover),
      tags: user.profile?.tags ?? [],
      mood: liveMood(user.profile),
    };
    return { ...base, completeness: profileCompleteness(base) };
  }

  async update(auth: AuthContext, input: MyProfileInput, meta: RequestMeta): Promise<MyProfile> {
    const { name, phone, ...rest } = input;
    if (name !== undefined || phone !== undefined) {
      await this.prisma.user.update({ where: { id: auth.userId }, data: { ...(name !== undefined ? { name } : {}), ...(phone !== undefined ? { phone } : {}) } });
    }
    const fields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (Object.keys(fields).length) {
      await this.prisma.userProfile.upsert({ where: { userId: auth.userId }, create: { userId: auth.userId, ...fields }, update: fields });
    }
    const changed = Object.keys(input).filter((k) => input[k as keyof MyProfileInput] !== undefined);
    if (changed.length) {
      await this.prisma.run(auth, (tx) =>
        this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'user.profile_updated', entityType: 'user', entityId: auth.userId, metadata: { fields: changed }, meta }),
      );
    }
    return this.mine(auth);
  }

  async setMood(auth: AuthContext, input: MoodInput, meta: RequestMeta): Promise<MyProfile> {
    const now = new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (expiresAt <= now || expiresAt.getTime() - now.getTime() > MOOD_MAX_DAYS * 86_400_000)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path: 'expiresAt', message: 'must be in the next 30 days' }] });
    }
    const data = { moodEmoji: input.emoji, moodText: input.text ?? null, moodSetAt: now, moodExpiresAt: expiresAt };
    await this.prisma.userProfile.upsert({ where: { userId: auth.userId }, create: { userId: auth.userId, ...data }, update: data });
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'user.mood_set', entityType: 'user', entityId: auth.userId, metadata: { emoji: input.emoji }, meta }),
    );
    return this.mine(auth);
  }

  async clearMood(auth: AuthContext): Promise<MyProfile> {
    await this.prisma.userProfile.updateMany({ where: { userId: auth.userId }, data: { moodEmoji: null, moodText: null, moodSetAt: null, moodExpiresAt: null } });
    return this.mine(auth);
  }

  /** Photo, headline and mood of everyone active in the caller's workspace. */
  async cards(auth: AuthContext): Promise<PersonCard[]> {
    const members = await this.prisma.run(auth, (tx) =>
      tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE' }, select: { userId: true } }),
    );
    const ids = [...new Set(members.map((m) => m.userId))];
    if (!ids.length) return [];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true, name: true, photo: { select: { updatedAt: true } }, profile: true } });
    const now = new Date();
    return users.map((u) => {
      const mood = liveMood(u.profile, now);
      return { id: u.id, name: u.name, photoUrl: photoUrl(u.id, u.photo?.updatedAt), headline: u.profile?.headline ?? null, mood: mood ? { emoji: mood.emoji, text: mood.text } : null };
    });
  }

  /** A teammate's full profile. Someone outside the caller's workspace is "not found". */
  async person(auth: AuthContext, userId: string): Promise<PersonProfile> {
    const missing = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Person not found.' });
    const membership = await this.prisma.run(auth, async (tx) => {
      const m = await tx.membership.findFirst({
        where: { tenantId: auth.tenantId, userId, ...(userId === auth.userId ? {} : { status: 'ACTIVE' }) },
        select: { designationId: true, departmentId: true, role: { select: { name: true } } },
      });
      if (!m) return null;
      const [designation, department] = await Promise.all([
        m.designationId ? tx.designation.findFirst({ where: { tenantId: auth.tenantId, id: m.designationId }, select: { name: true } }) : null,
        m.departmentId ? tx.department.findFirst({ where: { tenantId: auth.tenantId, id: m.departmentId }, select: { name: true } }) : null,
      ]);
      return { role: m.role.name, designation: designation?.name ?? null, department: department?.name ?? null };
    });
    if (!membership) throw missing();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user) throw missing();
    return {
      id: user.id,
      self: user.id === auth.userId,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      photoUrl: photoUrl(user.id, user.photo?.updatedAt),
      headline: user.profile?.headline ?? null,
      quote: user.profile?.quote ?? null,
      bio: user.profile?.bio ?? null,
      linkedinUrl: user.profile?.linkedinUrl ?? null,
      cover: coverOf(user.profile?.cover),
      tags: user.profile?.tags ?? [],
      mood: liveMood(user.profile),
      ...membership,
    };
  }
}
