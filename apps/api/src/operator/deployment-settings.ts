import type { ApiEnv } from '../common/env';

/**
 * The settings that stay in the deployment's environment (ADR 0053, narrowed by ADR 0059), listed in the operator
 * console so nobody has to guess why they are not editable there. Only the database connection is a secret: every API
 * key, ENCRYPTION_KEY and the session signing secrets are stored in the database, and a production server generates
 * the last three on its first start. The two addresses come from DOMAIN, which the install script fills in.
 * `show` marks values that are not secret and may be shown in full.
 */
export const DEPLOYMENT_SETTINGS: { name: keyof ApiEnv; show: boolean; why: string }[] = [
  { name: 'DATABASE_URL', show: false, why: 'How to reach the database (its address and password). Everything else, every API key and the encryption key included, is saved in that database, so this one has to be known before anything can be read. The install script generates the password.' },
  { name: 'PUBLIC_WEB_URL', show: true, why: 'The address of this deployment. Every redirect and webhook URL shown on this page is built from it, and it is built from the domain given to the install script.' },
  { name: 'WEB_ORIGINS', show: true, why: 'Which web addresses may call the API. It is checked before anyone signs in, so it is part of the server setup.' },
];
