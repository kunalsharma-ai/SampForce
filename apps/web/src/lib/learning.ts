'use client';

import type {
  LearningBrand,
  AnswerInput,
  AssigneeOption,
  AssignmentRow,
  AttemptView,
  CertificateRow,
  CertificateVerification,
  GenerateQuestionsInput,
  GenerateResult,
  LearningCategoryRow,
  LearningFileRef,
  LearningManageView,
  LearningModuleDetail,
  LearningSettingsView,
  MarkingDetail,
  MarkingRow,
  MyLearningView,
  PlayerView,
  QuestionView,
  VideoInfo,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { MessageKey } from './i18n';

/*
 * Learning & Development in the browser (ADR 0097). Everything is read from and saved to the API; the page never
 * decides a score, a pass or an attempt count.
 */

export const LEARNING_KEY = ['learning'] as const;

export function useMyLearning(filters: { categoryId?: string; from?: string; to?: string } = {}) {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => !!v) as [string, string][]);
  return useQuery({ queryKey: [...LEARNING_KEY, 'me', q.toString()], queryFn: () => api<MyLearningView>(`/learning/me${q.size ? `?${q}` : ''}`) });
}

export function usePlayer(moduleId: string) {
  return useQuery({ queryKey: [...LEARNING_KEY, 'player', moduleId], queryFn: () => api<PlayerView>(`/learning/modules/${moduleId}/player`) });
}

export function useLessonText(moduleId: string, lessonId: string, enabled = true) {
  return useQuery({ enabled, queryKey: [...LEARNING_KEY, 'text', lessonId], queryFn: () => api<{ text: string | null; source: string | null; note: string | null }>(`/learning/modules/${moduleId}/lessons/${lessonId}/text`), staleTime: 300_000 });
}

/** One row of the learning report (and the Excel export). */
export interface LearningReportRow {
  assignment: AssignmentRow;
  employeeId: string;
  manager: string | null;
  category: string | null;
  startedAt: string | null;
  certificateNumber: string | null;
  certificateStatus: 'ISSUED' | 'REVOKED' | 'NOT_YET' | 'NOT_ELIGIBLE';
}

export function useLearningReport(query: Record<string, string>, enabled = true) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => !!v));
  return useQuery({ enabled, queryKey: [...LEARNING_KEY, 'report', q.toString()], queryFn: () => api<LearningReportRow[]>(`/learning/reports${q.size ? `?${q}` : ''}`) });
}

export function useAttempt(attemptId: string, team = false) {
  return useQuery({ queryKey: [...LEARNING_KEY, 'attempt', attemptId], queryFn: () => api<AttemptView>(team ? `/learning/team-attempts/${attemptId}` : `/learning/attempts/${attemptId}`) });
}

export function useManage(enabled = true) {
  return useQuery({ enabled, queryKey: [...LEARNING_KEY, 'manage'], queryFn: () => api<LearningManageView>('/learning/manage'), retry: false });
}

export function useModule(id: string) {
  return useQuery({ queryKey: [...LEARNING_KEY, 'module', id], queryFn: () => api<LearningModuleDetail>(`/learning/modules/${id}`) });
}

export function useModuleAssignments(id: string, enabled = true) {
  return useQuery({ enabled, queryKey: [...LEARNING_KEY, 'module', id, 'assignments'], queryFn: () => api<AssignmentRow[]>(`/learning/modules/${id}/assignments`) });
}

export function useAssignees(enabled = true) {
  return useQuery({ enabled, queryKey: [...LEARNING_KEY, 'assignees'], queryFn: () => api<AssigneeOption[]>('/learning/assignees'), staleTime: 60_000 });
}

export function useCategories() {
  return useQuery({ queryKey: [...LEARNING_KEY, 'categories'], queryFn: () => api<LearningCategoryRow[]>('/learning/categories'), staleTime: 60_000 });
}

export function useLearningSettings() {
  return useQuery({ queryKey: [...LEARNING_KEY, 'settings'], queryFn: () => api<LearningSettingsView>('/learning/settings') });
}

/** How the organisation's certificates are branded (logo, name, colours from My Organization). */
export function useLearningBrand(enabled = true) {
  return useQuery({ queryKey: [...LEARNING_KEY, 'brand'], queryFn: () => api<LearningBrand>('/learning/brand'), enabled, staleTime: 60_000 });
}

export function useMarking(enabled = true) {
  return useQuery({ enabled, queryKey: [...LEARNING_KEY, 'marking'], queryFn: () => api<MarkingRow[]>('/learning/marking') });
}

export function useMarkingDetail(id: string) {
  return useQuery({ queryKey: [...LEARNING_KEY, 'marking', id], queryFn: () => api<MarkingDetail>(`/learning/marking/${id}`) });
}

export function useTeamCertificates(enabled = true) {
  return useQuery({ enabled, queryKey: [...LEARNING_KEY, 'certificates', 'team'], queryFn: () => api<CertificateRow[]>('/learning/certificates'), retry: false });
}

export function useBank(enabled = true) {
  return useQuery({ enabled, queryKey: [...LEARNING_KEY, 'bank'], queryFn: () => api<QuestionView[]>('/learning/bank') });
}

export function verifyCertificate(code: string) {
  return api<CertificateVerification>(`/learning/verify/${encodeURIComponent(code)}`);
}

/** A mutation that saves the module and puts the fresh module in the cache. */
export function useModuleChange<I>(id: string, request: (input: I) => Promise<LearningModuleDetail | (GenerateResult & { module: LearningModuleDetail })>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (out) => {
      const m = 'module' in out ? out.module : out;
      qc.setQueryData([...LEARNING_KEY, 'module', id], m);
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'manage'] });
    },
  });
}

export const learningApi = {
  createModule: (input: object) => api<LearningModuleDetail>('/learning/modules', { method: 'POST', json: input }),
  updateModule: (id: string, input: object) => api<LearningModuleDetail>(`/learning/modules/${id}`, { method: 'PATCH', json: input }),
  publish: (id: string) => api<LearningModuleDetail>(`/learning/modules/${id}/publish`, { method: 'POST', json: {} }),
  archive: (id: string) => api<LearningModuleDetail>(`/learning/modules/${id}/archive`, { method: 'POST', json: {} }),
  removeModule: (id: string) => api<void>(`/learning/modules/${id}`, { method: 'DELETE' }),
  inspectVideo: (url: string) => api<VideoInfo>('/learning/video/inspect', { method: 'POST', json: { url } }),
  addLesson: (id: string, input: object) => api<LearningModuleDetail>(`/learning/modules/${id}/lessons`, { method: 'POST', json: input }),
  updateLesson: (id: string, lessonId: string, input: object) => api<LearningModuleDetail>(`/learning/modules/${id}/lessons/${lessonId}`, { method: 'PATCH', json: input }),
  removeLesson: (id: string, lessonId: string) => api<LearningModuleDetail>(`/learning/modules/${id}/lessons/${lessonId}`, { method: 'DELETE' }),
  reorderLessons: (id: string, ids: string[]) => api<LearningModuleDetail>(`/learning/modules/${id}/lesson-order`, { method: 'PUT', json: { ids } }),
  addQuestion: (id: string, input: object) => api<LearningModuleDetail>(`/learning/modules/${id}/questions`, { method: 'POST', json: input }),
  updateQuestion: (id: string, qid: string, input: object) => api<LearningModuleDetail>(`/learning/modules/${id}/questions/${qid}`, { method: 'PUT', json: input }),
  removeQuestion: (id: string, qid: string) => api<LearningModuleDetail>(`/learning/modules/${id}/questions/${qid}`, { method: 'DELETE' }),
  reorderQuestions: (id: string, ids: string[]) => api<LearningModuleDetail>(`/learning/modules/${id}/question-order`, { method: 'PUT', json: { ids } }),
  review: (id: string, ids: string[], approve: boolean) => api<LearningModuleDetail>(`/learning/modules/${id}/questions/review`, { method: 'POST', json: { ids, approve } }),
  generate: (id: string, input: GenerateQuestionsInput) => api<GenerateResult & { module: LearningModuleDetail }>(`/learning/modules/${id}/generate`, { method: 'POST', json: input }),
  saveToBank: (id: string, questionIds: string[]) => api<{ saved: number }>(`/learning/modules/${id}/bank`, { method: 'POST', json: { questionIds } }),
  copyFromBank: (id: string, questionIds: string[]) => api<LearningModuleDetail>(`/learning/modules/${id}/questions/from-bank`, { method: 'POST', json: { questionIds } }),
  assign: (id: string, input: object) => api<{ assigned: number; already: number; rows: AssignmentRow[] }>(`/learning/modules/${id}/assign`, { method: 'POST', json: input }),
  updateAssignment: (id: string, input: object) => api<AssignmentRow>(`/learning/assignments/${id}`, { method: 'PATCH', json: input }),
  removeAssignment: (id: string) => api<void>(`/learning/assignments/${id}`, { method: 'DELETE' }),
  enrol: (moduleId: string) => api<PlayerView>(`/learning/modules/${moduleId}/enrol`, { method: 'POST', json: {} }),
  progress: (moduleId: string, lessonId: string, input: { percent?: number; positionSeconds?: number; seconds?: number; done?: boolean }) =>
    api<{ progress: number; done: boolean; lessonsDone: number; lessons: number }>(`/learning/modules/${moduleId}/lessons/${lessonId}/progress`, { method: 'PUT', json: input }),
  addNote: (moduleId: string, input: object) => api<unknown>(`/learning/modules/${moduleId}/notes`, { method: 'POST', json: input }),
  removeNote: (id: string) => api<void>(`/learning/notes/${id}`, { method: 'DELETE' }),
  startAttempt: (moduleId: string) => api<AttemptView>(`/learning/modules/${moduleId}/attempts`, { method: 'POST', json: {} }),
  saveAnswers: (attemptId: string, answers: Record<string, AnswerInput>) => api<{ saved: number; savedAt: string }>(`/learning/attempts/${attemptId}/answers`, { method: 'PUT', json: { answers } }),
  submit: (attemptId: string, answers: Record<string, AnswerInput>) => api<AttemptView>(`/learning/attempts/${attemptId}/submit`, { method: 'POST', json: { answers } }),
  mark: (attemptId: string, input: object) => api<MarkingDetail>(`/learning/marking/${attemptId}`, { method: 'POST', json: input }),
  addCategory: (input: object) => api<LearningCategoryRow[]>('/learning/categories', { method: 'POST', json: input }),
  updateCategory: (id: string, input: object) => api<LearningCategoryRow[]>(`/learning/categories/${id}`, { method: 'PATCH', json: input }),
  removeCategory: (id: string) => api<LearningCategoryRow[]>(`/learning/categories/${id}`, { method: 'DELETE' }),
  saveSettings: (input: object) => api<LearningSettingsView>('/learning/settings', { method: 'PUT', json: input }),
  revokeCertificate: (id: string, revoked: boolean) => api<CertificateRow>(`/learning/certificates/${id}/revoke`, { method: 'POST', json: { revoked } }),
  removeFromBank: (id: string) => api<void>(`/learning/bank/${id}`, { method: 'DELETE' }),
  certificate: (id: string) => api<CertificateRow & { verifyUrl: string }>(`/learning/certificates/${id}`),
};

/** Where a learning file is read from: shown in the page, or downloaded. */
export const fileUrl = (id: string, download = false) => `/api/v1/learning/files/${id}${download ? '?download=1' : ''}`;
export const certificatePdfUrl = (id: string, download = false) => `/api/v1/learning/certificates/${id}/pdf${download ? '?download=1' : ''}`;

/**
 * Uploads a file in parts (so a large video never travels in one request), reporting progress, and returns the
 * finished file. Parts are retried a few times when the connection drops.
 */
export async function uploadLearningFile(file: File, onProgress?: (fraction: number) => void, attemptId?: string): Promise<LearningFileRef> {
  const created = await api<{ id: string; parts: number; partBytes: number }>('/learning/files', { method: 'POST', json: { name: file.name, contentType: file.type || undefined, sizeBytes: file.size, ...(attemptId ? { attemptId } : {}) } });
  for (let i = 0; i < created.parts; i++) {
    const blob = file.slice(i * created.partBytes, (i + 1) * created.partBytes);
    let tries = 0;
    for (;;) {
      try {
        await api(`/learning/files/${created.id}/parts/${i}`, { method: 'PUT', body: blob, headers: { 'content-type': 'application/octet-stream' } });
        break;
      } catch (err) {
        if (++tries >= 3) throw err;
        await new Promise((r) => setTimeout(r, 800 * tries));
      }
    }
    onProgress?.((i + 1) / created.parts);
  }
  return api<LearningFileRef>(`/learning/files/${created.id}/complete`, { method: 'POST', json: {} });
}

export function minutesText(n: number, t: (s: MessageKey, v?: Record<string, string | number>) => string): string {
  if (n < 60) return t('{n} min', { n });
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? t('{h} h {m} min', { h, m }) : t('{h} h', { h });
}
