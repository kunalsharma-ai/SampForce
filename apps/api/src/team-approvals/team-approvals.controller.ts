import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  type CreateTeamApprovalInput,
  createTeamApprovalSchema,
  decideTeamApprovalSchema,
  type TeamApprovalQuery,
  teamApprovalQuerySchema,
  type TeamApprovalSettings,
  teamApprovalSettingsSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, MobileAccess, type RequestMeta } from '../common/auth-context';
import { ConfirmPassword } from '../common/password-confirmation';
import { ZodPipe } from '../common/zod.pipe';
import { RecycleBinService } from './recycle-bin.service';
import { TeamApprovalsService } from './team-approvals.service';

const uuid = new ParseUUIDPipe();

/**
 * The Approval section (ADR 0098). Open to every member: what each person sees and may decide follows their
 * workspace (Super: everything; Manager: its team's requests; Executive: their own).
 */
@Controller('team-approvals')
@MobileAccess()
export class TeamApprovalsController {
  constructor(private readonly approvals: TeamApprovalsService) {}

  @Get('overview')
  overview(@Auth() auth: AuthContext) {
    return this.approvals.overview(auth);
  }

  @Get()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(teamApprovalQuerySchema)) q: TeamApprovalQuery) {
    return this.approvals.list(auth, q);
  }

  @Put('settings')
  settings(@Auth() auth: AuthContext, @Body(new ZodPipe(teamApprovalSettingsSchema)) body: TeamApprovalSettings, @Meta() meta: RequestMeta) {
    return this.approvals.updateSettings(auth, body, meta);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.approvals.get(auth, id);
  }

  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(createTeamApprovalSchema)) body: CreateTeamApprovalInput, @Meta() meta: RequestMeta) {
    return this.approvals.create(auth, body, meta);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(decideTeamApprovalSchema)) body: z.infer<typeof decideTeamApprovalSchema>, @Meta() meta: RequestMeta) {
    return this.approvals.decide(auth, id, body.decision, body.note, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.approvals.cancel(auth, id, meta);
  }
}

const deletedQuery = z.object({ q: z.string().trim().max(100).optional(), state: z.enum(['kept', 'restored', 'any']).default('kept') });

/** Deleted items: what delete requests removed, restorable until the keep period ends. */
@Controller('deleted-items')
export class DeletedItemsController {
  constructor(private readonly bin: RecycleBinService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(deletedQuery)) q: z.infer<typeof deletedQuery>) {
    return this.bin.list(auth, q);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.bin.restore(auth, id, meta);
  }

  /** Removes the kept copies for good; like any delete it asks for the password (and, for executives, approval). */
  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  purge(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.bin.purge(auth, id, meta);
  }
}
