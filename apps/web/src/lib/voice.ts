import type { TranscriptionStatus, VoiceAction, VoiceNote, VoiceNoteCreate, VoiceRecordType } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { toQuery } from './crm';

export interface VoiceRecordRef {
  type: VoiceRecordType;
  id: string;
}

export function useVoiceNotes(record: VoiceRecordRef | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['voice-notes', record],
    queryFn: () => api<VoiceNote[]>(`/voice-notes${record ? toQuery({ type: record.type, id: record.id }) : ''}`),
  });
}

export function useVoiceTranscriptionStatus(enabled = true) {
  return useQuery({ enabled, queryKey: ['voice-notes', 'transcription-status'], queryFn: () => api<TranscriptionStatus>('/voice-notes/transcription-status') });
}

/** The person's own calendar date, so "tomorrow" means their tomorrow. */
export function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Every voice-note call returns the whole note; keep the lists in step. */
export function useVoiceMutation<T>(fn: (arg: T) => Promise<VoiceNote>, onDone?: (n: VoiceNote) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (n) => {
      onDone?.(n);
      await qc.invalidateQueries({ queryKey: ['voice-notes'] });
    },
  });
}

export const voiceApi = {
  create: (body: VoiceNoteCreate) => api<VoiceNote>('/voice-notes', { method: 'POST', json: body }),
  update: (id: string, body: { transcript?: string; language?: string }) => api<VoiceNote>(`/voice-notes/${id}`, { method: 'PATCH', json: body }),
  remove: (id: string) => api<void>(`/voice-notes/${id}`, { method: 'DELETE' }),
  /** The audio is streamed to the transcription service and is not kept. */
  transcribe: (id: string, audio: Blob) =>
    api<VoiceNote>(`/voice-notes/${id}/recording?consent=true`, { method: 'POST', headers: { 'content-type': audio.type.split(';')[0] || 'audio/webm' }, body: audio }),
  interpret: (id: string) => api<VoiceNote>(`/voice-notes/${id}/interpret`, { method: 'POST', json: { today: localToday() } }),
  apply: (id: string, items: { index: number; action: VoiceAction }[]) =>
    api<VoiceNote>(`/voice-notes/${id}/apply`, { method: 'POST', json: { items, timezoneOffsetMinutes: new Date().getTimezoneOffset() } }),
};
