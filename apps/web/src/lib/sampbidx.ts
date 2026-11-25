'use client';

import type { AppStatus, SampbidxPastedCheck, SampbidxMailboxEmail, SampbidxRfqReadiness, SampbidxSendMailboxEmailInput, SampbidxSendPastedEmailInput, SampbidxSendRfqInput, SampbidxTransferRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { api } from './api';

/** SampBidx (ADR 0061): sending RFQs and RFQ emails, and what happened to them. */

export function useSampbidxApp(enabled = true) {
  return useQuery({ enabled, queryKey: ['apps'], queryFn: () => api<AppStatus[]>('/apps'), select: (apps) => apps.find((a) => a.key === 'sampbidx') ?? null });
}

export function useSampbidxReadiness(rfqId: string | null) {
  return useQuery({ enabled: !!rfqId, queryKey: ['sampbidx', 'rfq', rfqId], queryFn: () => api<SampbidxRfqReadiness>(`/apps/sampbidx/rfqs/${rfqId}`) });
}

export function useSampbidxTransfers(f: { rfqId?: string; companyId?: string } = {}, enabled = true) {
  const qs = new URLSearchParams({ limit: '100' });
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  return useQuery({ enabled, queryKey: ['sampbidx', 'transfers', f], queryFn: () => api<SampbidxTransferRow[]>(`/apps/sampbidx/transfers?${qs}`) });
}

export function useSampbidxMailbox(q: string, enabled = true) {
  return useQuery({ enabled, queryKey: ['sampbidx', 'mailbox', q], queryFn: () => api<SampbidxMailboxEmail[]>(`/apps/sampbidx/mailbox?limit=30${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
}

export function useSampbidxSend() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['sampbidx'] }), qc.invalidateQueries({ queryKey: ['apps'] })]);
  return {
    rfq: useMutation({ mutationFn: (input: SampbidxSendRfqInput) => api<SampbidxTransferRow>('/apps/sampbidx/transfers/rfq', { method: 'POST', json: input }), onSettled: refresh }),
    mailbox: useMutation({ mutationFn: (input: SampbidxSendMailboxEmailInput) => api<SampbidxTransferRow>('/apps/sampbidx/transfers/mailbox-email', { method: 'POST', json: input }), onSettled: refresh }),
    file: useMutation({
      mutationFn: ({ file, companyId, rfqId, note }: { file: File; companyId?: string | null; rfqId?: string | null; note?: string }) => {
        const qs = new URLSearchParams({ name: file.name });
        if (companyId) qs.set('companyId', companyId);
        if (rfqId) qs.set('rfqId', rfqId);
        if (note?.trim()) qs.set('note', note.trim());
        return api<SampbidxTransferRow>(`/apps/sampbidx/transfers/email-file?${qs}`, { method: 'POST', body: file, headers: { 'content-type': emailFileType(file) } });
      },
      onSettled: refresh,
    }),
    pasted: useMutation({
      mutationFn: (input: SampbidxSendPastedEmailInput) => api<SampbidxTransferRow>('/apps/sampbidx/transfers/pasted-email', { method: 'POST', json: input }),
      // The pasted email is also logged on the company as an interaction.
      onSettled: (_r, _e, input) => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['interactions', input.companyId] }), qc.invalidateQueries({ queryKey: ['company-kpis', input.companyId] })]),
    }),
    retry: useMutation({ mutationFn: (id: string) => api<SampbidxTransferRow>(`/apps/sampbidx/transfers/${id}/retry`, { method: 'POST', json: {} }), onSettled: refresh }),
  };
}

/** Browsers often leave .eml and .msg files without a type. */
export function emailFileType(file: File): string {
  if (file.type) return file.type;
  return file.name.toLowerCase().endsWith('.msg') ? 'application/vnd.ms-outlook' : 'message/rfc822';
}

/** What SampForce reads from pasted RFQ email text and who it would link it to, checked a moment after typing stops. */
export function useSampbidxPastedCheck(text: string, companyId: string | null, contactId: string | null) {
  const [settled, setSettled] = React.useState(text);
  React.useEffect(() => {
    const h = setTimeout(() => setSettled(text), 350);
    return () => clearTimeout(h);
  }, [text]);
  const ready = settled.trim().length >= 20;
  return useQuery({
    enabled: ready,
    queryKey: ['sampbidx', 'pasted-check', settled, companyId, contactId],
    queryFn: () => api<SampbidxPastedCheck>('/apps/sampbidx/pasted-email/check', { method: 'POST', json: { text: settled, companyId, contactId } }),
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
}

export interface SampbidxUploadedFile {
  id: string;
  name: string;
  sizeBytes: number;
  contentType: string;
}

export function useSampbidxAttachments() {
  return {
    add: useMutation({
      mutationFn: (file: File) => api<SampbidxUploadedFile>(`/apps/sampbidx/attachments?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } }),
    }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/apps/sampbidx/attachments/${id}`, { method: 'DELETE' }) }),
  };
}
