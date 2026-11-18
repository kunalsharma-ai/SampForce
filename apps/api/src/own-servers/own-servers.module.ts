import { Module } from '@nestjs/common';
import { OwnServersController } from './own-servers.controller';
import { OwnServersService } from './own-servers.service';

/** Settings for a workspace's own AI and email servers (ADR 0068). The reader they share lives in the global mail module. */
@Module({ controllers: [OwnServersController], providers: [OwnServersService] })
export class OwnServersModule {}
