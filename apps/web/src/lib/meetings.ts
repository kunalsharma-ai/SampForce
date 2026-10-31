import type { MeetingRecord, MeetingRecordRow, TranscriptionStatus } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { toQuery } from './crm';

export function useMeetingRecords(filter: { dealId?: string; contactId?: string; leadId?: string } = {}, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['meeting-records', filter],
    queryFn: () => api<MeetingRecordRow[]>(`/meeting-records${toQuery(filter)}`),
  });
}

export function useMeetingRecord(id: string) {
  return useQuery({ queryKey: ['meeting-records', 'one', id], queryFn: () => api<MeetingRecord>(`/meeting-records/${id}`) });
}

export function useTranscriptionStatus() {
  return useQuery({ queryKey: ['meeting-records', 'transcription-status'], queryFn: () => api<TranscriptionStatus>('/meeting-records/transcription-status') });
}

/** Uploads a recording as the raw request body. It is streamed to the transcription service and not kept. */
export function uploadRecording(id: string, file: File) {
  return api<MeetingRecord>(`/meeting-records/${id}/recording?consent=true`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
}
