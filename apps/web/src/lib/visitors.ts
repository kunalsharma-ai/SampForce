import type { RecordWebActivity, VisitorDashboard, VisitorDetail, VisitorRow, VisitorSettings, VisitorSettingsInput } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type VisitorSegment = 'all' | 'identified' | 'anonymous' | 'high_intent';

export function useVisitorDashboard(days: number) {
  return useQuery({ queryKey: ['visitors', 'dashboard', days], queryFn: () => api<VisitorDashboard>(`/visitors/dashboard?days=${days}`) });
}

export function useVisitors(segment: VisitorSegment, search: string) {
  const q = new URLSearchParams({ segment, ...(search ? { search } : {}) });
  return useQuery({ queryKey: ['visitors', 'list', segment, search], queryFn: () => api<VisitorRow[]>(`/visitors?${q}`) });
}

export function useVisitor(id: string | null) {
  return useQuery({ enabled: !!id, queryKey: ['visitors', 'detail', id], queryFn: () => api<VisitorDetail>(`/visitors/${id}`) });
}

export function useVisitorSettings() {
  return useQuery({ queryKey: ['visitors', 'settings'], queryFn: () => api<VisitorSettings>('/visitors/settings') });
}

export function useRecordWebActivity(type: 'lead' | 'contact', id: string, enabled = true) {
  return useQuery({ enabled, queryKey: ['visitors', 'record', type, id], queryFn: () => api<RecordWebActivity>(`/visitors/record?type=${type}&id=${id}`) });
}

export function useVisitorMutation<A, R>(fn: (a: A) => Promise<R>, onDone?: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      onDone?.(r);
      await qc.invalidateQueries({ queryKey: ['visitors'] });
    },
  });
}

export const visitorsApi = {
  saveSettings: (body: VisitorSettingsInput) => api<VisitorSettings>('/visitors/settings', { method: 'PUT', json: body }),
  rotateKey: () => api<VisitorSettings>('/visitors/settings/rotate-key', { method: 'POST' }),
  erase: (id: string) => api<void>(`/visitors/${id}`, { method: 'DELETE' }),
};

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The snippet a site owner pastes into their pages, with a consent call for their cookie banner. */
export function installSnippet(origin: string, siteKey: string, consentMode: 'opt_in' | 'notice'): string {
  return [
    '<script>window.dealflow=window.dealflow||function(){(window.dealflow.q=window.dealflow.q||[]).push(arguments)};</script>',
    `<script async src="${origin}/api/v1/public/track/script.js" data-site="${siteKey}"></script>`,
    consentMode === 'opt_in'
      ? '<!-- Nothing is recorded until your cookie banner calls: dealflow(\'consent\', true). Call dealflow(\'consent\', false) if they decline. -->'
      : '<!-- Recorded until the visitor declines. Call dealflow(\'consent\', false) from your cookie banner when they do. -->',
  ].join('\n');
}

export const ENQUIRY_FORM_EXAMPLE = `<form data-dealflow-enquiry>
  <input name="fullName" required placeholder="Your name">
  <input name="email" type="email" required placeholder="Work email">
  <input name="companyName" placeholder="Company">
  <textarea name="message" placeholder="How can we help?"></textarea>
  <label><input type="checkbox" name="consent"> <span data-dealflow-consent-text></span></label>
  <p data-dealflow-error></p>
  <button>Send</button>
</form>`;
