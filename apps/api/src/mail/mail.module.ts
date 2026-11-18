import { Global, Module } from '@nestjs/common';
import { OwnServersStore } from '../own-servers/own-servers.store';
import { MailerService } from './mailer.service';

/** SampForce's own email, and the reader of each workspace's own email and AI servers (ADR 0068). */
@Global()
@Module({ providers: [MailerService, OwnServersStore], exports: [MailerService, OwnServersStore] })
export class MailModule {}
