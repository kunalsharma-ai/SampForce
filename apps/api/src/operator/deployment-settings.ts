import type { ApiEnv } from '../common/env';

/**
 * The settings that stay in the deployment's environment (ADR 0053), listed in the operator console so nobody has to
 * guess why they are not editable there. Everything an integration needs is entered in the console instead.
 * `show` marks values that are not secret and may be shown in full.
 */
export const DEPLOYMENT_SETTINGS: { name: keyof ApiEnv; show: boolean; why: string }[] = [
  { name: 'DATABASE_URL', show: false, why: 'Where the console itself saves everything. It has to be known before anything can be read from the database.' },
  { name: 'ENCRYPTION_KEY', show: false, why: 'Encrypts the keys saved in this console. Storing it next to what it protects would protect nothing.' },
  { name: 'JWT_ACCESS_SECRET', show: false, why: 'Signs every sign-in. Changing it from a screen signed in with it would sign everyone out, and anyone who could change it could forge a sign-in.' },
  { name: 'OPERATOR_JWT_SECRET', show: false, why: 'Signs operator console sign-ins, including the one changing settings here, so it cannot be edited from here.' },
  { name: 'PUBLIC_WEB_URL', show: true, why: 'The address of this deployment. Every redirect and webhook URL shown on this page is built from it, and it is set when the server and its domain are set up.' },
  { name: 'WEB_ORIGINS', show: true, why: 'Which web addresses may call the API. It is checked before anyone signs in, so it is part of the server setup.' },
];
