import type { MfaStatus, SecuritySettings, SessionSummary } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** Data hooks for account security (two-step verification, devices) and workspace security settings. */

export function useMfaStatus() {
  return useQuery({ queryKey: ['mfa'], queryFn: () => api<MfaStatus>('/auth/mfa') });
}

export function useSessions() {
  return useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionSummary[]>('/auth/sessions') });
}

export function useSecuritySettings(enabled = true) {
  return useQuery({ enabled, queryKey: ['security-settings'], queryFn: () => api<SecuritySettings>('/security/settings') });
}

/** "Chrome on macOS" from a user-agent string; good enough to tell your own devices apart. */
export function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const ext = ua.match(/^SampForce browser extension \((.+)\)$/);
  if (ext) return `Browser extension: ${ext[1]}`;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|undici/i.test(ua) ? 'Script' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}

export const AUTH_METHOD_LABEL = { password: 'Password', mfa: 'Password + code', sso: 'Single sign-on' } as const;
