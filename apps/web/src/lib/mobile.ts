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

/** Mobile Configuration Center (ADR 0072, M2): names for levels, notification types and phone actions. */
export const MOBILE_LEVEL_LABEL: Record<'SUPER' | 'MANAGER' | 'EXECUTIVE', string> = { SUPER: 'Super Workspace', MANAGER: 'Manager Workspace', EXECUTIVE: 'Executive Workspace' };

export const MOBILE_NOTIFICATION_LABEL: Record<string, string> = {
  task_assigned: 'Task assigned',
  task_due_soon: 'Task due soon',
  task_overdue: 'Task overdue',
  chat_message: 'New chat message',
  lead_assigned: 'Company assigned',
  follow_up_reminder: 'Follow-up reminder',
  target_update: 'Target update',
  announcement: 'Announcement',
  account_status: 'Account status changes',
};

export const MOBILE_PHONE_ACTION_LABEL: Record<string, string> = { call: 'Call', email: 'Email', whatsapp: 'WhatsApp', directions: 'Directions', share: 'Share' };
