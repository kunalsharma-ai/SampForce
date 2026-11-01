import { Module } from '@nestjs/common';
import { PreferencesController, WorkspaceAppearanceController } from './preferences.controller';
import { NavigationService } from './navigation.service';
import { PreferencesService } from './preferences.service';

/** Theme engine persistence: per-person appearance, saved themes, the workspace default (ADR 0040) and personal navigation (ADR 0041). */
@Module({ controllers: [PreferencesController, WorkspaceAppearanceController], providers: [PreferencesService, NavigationService] })
export class PreferencesModule {}
