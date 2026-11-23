import { z } from 'zod';
import { loginSchema } from './auth';

/*
 * The SampForce mobile app (ADR 0072). Three gates decide whether anyone in an organisation can use it, and the API
 * checks all three on every request a phone makes:
 *
 *  1. The Console Admin (operator console) approves mobile access for the organisation. The plan must include the
 *     `mobile_app` feature too, so the Console can also offer it per plan.
 *  2. The Super Workspace activates it for its organisation (and, from M2, publishes the app's configuration).
 *  3. The workspace hierarchy and the person's role narrow what each person can do.
 *
 * Mobile access is separate from web access: switching it off ends phone sessions and nothing else.
 */

/**
 * The Console's decision for one organisation.
 *  - OFF: never asked for or switched on.
 *  - REQUESTED: the Super Workspace asked; the Console has not decided.
 *  - APPROVED: the Super Workspace may set the app up and activate it.
 *  - REJECTED: the Console said no to a request; the Super Workspace may ask again.
 *  - SUSPENDED: temporarily stopped; reinstating restores the approval and the activation as they were.
 *  - REVOKED: withdrawn; the activation is cleared and the Console must approve again.
 */
export const MOBILE_ACCESS_STATUSES = ['OFF', 'REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED'] as const;
export type MobileAccessStatus = (typeof MOBILE_ACCESS_STATUSES)[number];

export const MOBILE_PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

/** Why phones cannot sign in right now, when they can't. `null` reason = they can. */
export type MobileBlockReason =
  | 'NOT_IN_PLAN'
  | 'NOT_APPROVED'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'NOT_ACTIVATED'
  | 'WORKSPACE_SUSPENDED';

/** The organisation's mobile state, as the Console, the Super Workspace and the API's gate all see it. */
export interface MobileAccessState {
  status: MobileAccessStatus;
  /** The plan (with the Console's per-client overrides) includes the mobile app. */
  inPlan: boolean;
  /** The Super Workspace has switched mobile access on for its people. */
  activated: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
  /** Phones can sign in now. */
  live: boolean;
  /** Why they can't, when they can't. */
  blockedBy: MobileBlockReason | null;
  request: { message: string | null; requestedAt: string; requestedBy: string | null } | null;
  /** The Console's last decision and its reason, shown to the Super Workspace. */
  decision: { status: MobileAccessStatus; reason: string | null; decidedAt: string } | null;
  /** Maximum phones signed in at once across the organisation; null = no limit. */
  maxDevices: number | null;
  devices: { active: number; ios: number; android: number; web: number };
}

/** A signed-in phone. Names appear only to the organisation itself (operators see counts unless granted support access). */
export interface MobileDeviceRow {
  id: string;
  platform: MobilePlatform;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  name: string | null;
  person: { name: string; email: string } | null;
  pushEnabled: boolean;
  createdAt: string;
  lastSeenAt: string;
  current?: boolean;
}

/** One row of the Console's mobile overview. */
export interface OperatorMobileRow {
  tenantId: string;
  name: string;
  planCode: string | null;
  status: MobileAccessStatus;
  inPlan: boolean;
  activated: boolean;
  live: boolean;
  requestedAt: string | null;
  requestMessage: string | null;
  devices: { active: number; ios: number; android: number; web: number };
  lastSeenAt: string | null;
}

export interface OperatorMobileOverview {
  totals: { organisations: number; live: number; requested: number; suspended: number; devices: number; ios: number; android: number };
  /** App versions in use across all organisations, newest first. */
  versions: { appVersion: string; platform: MobilePlatform; devices: number }[];
  rows: OperatorMobileRow[];
}

export interface OperatorMobileDetail {
  state: MobileAccessState;
  /** Devices without names (no support access), or with them while the organisation grants support access. */
  devices: MobileDeviceRow[];
  history: { action: string; reason: string | null; at: string; by: string | null }[];
}

// ───────────── Console Admin decisions ─────────────

export const OPERATOR_MOBILE_ACTIONS = ['approve', 'reject', 'suspend', 'reinstate', 'revoke'] as const;
export type OperatorMobileAction = (typeof OPERATOR_MOBILE_ACTIONS)[number];

export const operatorMobileActionSchema = z
  .object({
    action: z.enum(OPERATOR_MOBILE_ACTIONS),
    reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
  })
  .strict();
export type OperatorMobileActionInput = z.infer<typeof operatorMobileActionSchema>;

export const operatorMobileLimitsSchema = z
  .object({
    maxDevices: z.number().int().min(1).max(100_000).nullable(),
    reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
  })
  .strict();
export type OperatorMobileLimitsInput = z.infer<typeof operatorMobileLimitsSchema>;

// ───────────── Super Workspace ─────────────

export const mobileAccessRequestSchema = z.object({ message: z.string().trim().max(1000).optional() }).strict();
export type MobileAccessRequestInput = z.infer<typeof mobileAccessRequestSchema>;

export const mobileActivationSchema = z.object({ activated: z.boolean() }).strict();
export type MobileActivationInput = z.infer<typeof mobileActivationSchema>;

// ───────────── Phone sign-in ─────────────

export const mobileDeviceInfoSchema = z
  .object({
    platform: z.enum(MOBILE_PLATFORMS),
    /** The app's own install id (random, kept in secure storage), so one phone is one device row across sign-ins. */
    installId: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - and _ only'),
    model: z.string().trim().max(100).optional(),
    osVersion: z.string().trim().max(40).optional(),
    appVersion: z.string().trim().max(40).optional(),
    name: z.string().trim().max(100).optional(),
  })
  .strict();
export type MobileDeviceInfo = z.infer<typeof mobileDeviceInfoSchema>;

export const mobileLoginSchema = loginSchema.extend({ device: mobileDeviceInfoSchema }).strict();
export type MobileLoginInput = z.infer<typeof mobileLoginSchema>;

export const mobileMfaVerifySchema = z
  .object({ challenge: z.string().min(1).max(2000), code: z.string().trim().min(6).max(20), device: mobileDeviceInfoSchema })
  .strict();
export type MobileMfaVerifyInput = z.infer<typeof mobileMfaVerifySchema>;

export const mobileRefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
export type MobileRefreshInput = z.infer<typeof mobileRefreshSchema>;

export const mobileSwitchWorkspaceSchema = z.object({ tenantId: z.string().uuid() }).strict();

/** What a successful phone sign-in or refresh returns. The refresh token goes into the phone's secure storage. */
export interface MobileTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires; the app refreshes a little before. */
  expiresIn: number;
  tenantId: string;
  deviceId: string;
}

export type MobileLoginResponse = MobileTokens | { mfaRequired: true; challenge: string };

/** The workspace level the app is shaped for. Comes from the workspace hierarchy (ADR 0071). */
export const WORKSPACE_LEVELS_FOR_MOBILE = ['SUPER', 'MANAGER', 'EXECUTIVE'] as const;
export type MobileWorkspaceLevel = (typeof WORKSPACE_LEVELS_FOR_MOBILE)[number];

/** Who is signed in on the phone, and in which organisation. */
export interface MobileSession {
  user: { id: string; name: string; email: string; photoUrl: string | null };
  organisation: { id: string; name: string; brandColor: string | null };
  level: MobileWorkspaceLevel;
  designation: string | null;
  role: string;
  permissions: string[];
  /** Other organisations of the person where mobile access is live; the app can switch to them. */
  workspaces: { tenantId: string; name: string }[];
  device: { id: string; platform: MobilePlatform };
  /** The published Mobile Configuration version (0 = the built-in default). When it changes, fetch /mobile/config. */
  configVersion: number;
}

