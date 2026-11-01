import { Module } from '@nestjs/common';
import { PreferencesController, WorkspaceAppearanceController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

/** Theme engine persistence: per-person appearance, saved themes and the workspace default (ADR 0040). */
@Module({ controllers: [PreferencesController, WorkspaceAppearanceController], providers: [PreferencesService] })
export class PreferencesModule {}
