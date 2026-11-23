import type { MobileWorkspaceLevel } from '@dealflow/types';

/** Level names as the web shows them (apps/web/src/lib/mobile.ts). */
export const LEVEL_LABEL: Record<MobileWorkspaceLevel, string> = {
  SUPER: 'Super Workspace',
  MANAGER: 'Manager Workspace',
  EXECUTIVE: 'Executive Workspace',
};

/** Good morning / afternoon / evening, by the phone's clock. */
export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning, {name}';
  if (hour < 18) return 'Good afternoon, {name}';
  return 'Good evening, {name}';
}
