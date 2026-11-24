import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const CONFIRMS_PASSWORD = 'dealflow:confirmsPassword';
export const NO_PASSWORD_CONFIRMATION = 'dealflow:noPasswordConfirmation';

export interface ConfirmPasswordRule {
  /** Only when this holds, for a route that deletes on some requests only (a bulk action whose action is delete). */
  when?: (req: Request) => boolean;
}

/**
 * The route destroys something that matters: the request must carry a fresh password confirmation (see
 * PasswordConfirmationGuard). Every DELETE route, and every POST that deletes, is marked with this or with
 * @NoPasswordConfirmation; a test fails when a new one is neither.
 */
export const ConfirmPassword = (rule: ConfirmPasswordRule = {}) => SetMetadata(CONFIRMS_PASSWORD, rule);

/**
 * A removal that loses nothing worth a password: a personal setting back to its default, signing out a device,
 * withdrawing access or consent (which must stay quick), or a request made by a machine that cannot type one. The
 * reason is required so the choice is visible where the route is declared.
 */
export const NoPasswordConfirmation = (reason: string) => SetMetadata(NO_PASSWORD_CONFIRMATION, reason);
