import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditViewService } from './audit-view.service';

@Global()
@Module({ controllers: [AuditController], providers: [AuditService, AuditViewService], exports: [AuditService] })
export class AuditModule {}
