import type { MobileAccessStatus, MobileBlockReason, MobilePlatform } from '@dealflow/types';

/** Labels and badge tones for mobile access (ADR 0072), shared by the console and the Super Workspace settings. */
export const MOBILE_STATUS: Record<MobileAccessStatus, { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'critical' }> = {
  OFF: { label: 'Not requested', tone: 'neutral' },
  REQUESTED: { label: 'Requested', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'critical' },
  SUSPENDED: { label: 'Suspended', tone: 'critical' },
  REVOKED: { label: 'Revoked', tone: 'critical' },
};

export const MOBILE_BLOCK: Record<MobileBlockReason, string> = {
  NOT_IN_PLAN: 'The plan does not include the mobile app.',
  NOT_APPROVED: 'Waiting for approval from the SampForce team.',
  SUSPENDED: 'Suspended by the SampForce team.',
  REVOKED: 'Withdrawn by the SampForce team.',
  NOT_ACTIVATED: 'Approved, but not switched on yet.',
  WORKSPACE_SUSPENDED: 'The workspace is suspended.',
};

export const PLATFORM_LABEL: Record<MobilePlatform, string> = { IOS: 'iPhone', ANDROID: 'Android', WEB: 'Web preview' };
