import { applyDecorators, type CanActivate, type ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MobileModuleKey } from '@dealflow/types';
import { type AuthedRequest, MobileAccess } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { MobileConfigService } from './mobile-config.service';

const MOBILE_MODULE = 'dealflow:mobileModule';

/**
 * Checks, for phone sessions only, that the person's published Mobile Configuration has the module (and, for chat,
 * that chat is switched on). Web sessions are untouched: the web has its own feature and permission checks.
 */
@Injectable()
export class MobileModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly configs: MobileConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.auth;
    if (!auth || auth.via !== 'mobile') return true;
    const module = this.reflector.getAllAndOverride<MobileModuleKey>(MOBILE_MODULE, [ctx.getHandler(), ctx.getClass()]);
    if (!module) return true;
    const config = await this.prisma.run(auth, (tx) => this.configs.resolvedFor(tx, auth));
    const on = config.modules.some((m) => m.key === module) && (module !== 'chat' || config.chat.enabled);
    if (!on) throw new ForbiddenException({ code: 'MOBILE_MODULE_OFF', message: 'This part of SampForce is not available in your mobile app.' });
    return true;
  }
}

/** Reachable from the phone app, but only while the person's Mobile Configuration has this module. */
export const MobileModuleAccess = (module: MobileModuleKey) => applyDecorators(MobileAccess(), SetMetadata(MOBILE_MODULE, module), UseGuards(MobileModuleGuard));
