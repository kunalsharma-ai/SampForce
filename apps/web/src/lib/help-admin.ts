'use client';

import type {
  HelpArticleDetail,
  HelpArticleInput,
  HelpArticleRow,
  HelpArticleStatus,
  HelpCategoryEntryRow,
  HelpCategoryInput,
  HelpContentAudience,
  HelpFeedbackRow,
  HelpMediaRow,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/** The Console's Help management (ADR 0073): articles and versions, topics, files and readers' feedback. */
const keys = {
  all: ['operator', 'help'] as const,
  articles: (f: object) => ['operator', 'help', 'articles', f] as const,
  article: (id: string) => ['operator', 'help', 'article', id] as const,
  categories: ['operator', 'help', 'categories'] as const,
  media: ['operator', 'help', 'media'] as const,
  feedback: (f: object) => ['operator', 'help', 'feedback', f] as const,
};

export function useHelpArticles(
  filter: { status?: HelpArticleStatus; audience?: HelpContentAudience; q?: string },
  enabled: boolean,
) {
  const qs = new URLSearchParams(
    Object.entries(filter).filter(([, v]) => v) as [string, string][],
  ).toString();
  return useQuery({
    enabled,
    queryKey: keys.articles(filter),
    queryFn: () => api<HelpArticleRow[]>(`/operator/help/articles${qs ? `?${qs}` : ''}`),
  });
}

export function useHelpArticle(id: string | null) {
  return useQuery({
    enabled: !!id,
    queryKey: keys.article(id ?? ''),
    queryFn: () => api<HelpArticleDetail>(`/operator/help/articles/${id}`),
  });
}

function useDone() {
  const qc = useQueryClient();
  return (a: HelpArticleDetail) => {
    qc.setQueryData(keys.article(a.id), a);
    void qc.invalidateQueries({ queryKey: ['operator', 'help', 'articles'] });
    void qc.invalidateQueries({ queryKey: ['help', 'content'] });
  };
}

export function useSaveHelpArticle() {
  const done = useDone();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: HelpArticleInput }) =>
      api<HelpArticleDetail>(id ? `/operator/help/articles/${id}` : '/operator/help/articles', {
        method: id ? 'PUT' : 'POST',
        json: input,
      }),
    onSuccess: done,
  });
}

export function useHelpArticleAction() {
  const done = useDone();
  return useMutation({
    mutationFn: ({
      id,
      action,
      version,
    }: {
      id: string;
      action: 'publish' | 'unpublish' | 'archive' | 'restore';
      version?: number;
    }) =>
      api<HelpArticleDetail>(
        action === 'restore'
          ? `/operator/help/articles/${id}/versions/${version}/restore`
          : `/operator/help/articles/${id}/${action}`,
        { method: 'POST' },
      ),
    onSuccess: done,
  });
}

export function useHelpCategories(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: keys.categories,
    queryFn: () => api<HelpCategoryEntryRow[]>('/operator/help/categories'),
  });
}

export function useSaveHelpCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HelpCategoryInput) =>
      api<HelpCategoryEntryRow>('/operator/help/categories', { method: 'PUT', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.categories }),
  });
}

export function useArchiveHelpCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api<HelpCategoryEntryRow>(
        `/operator/help/categories/${id}/${archived ? 'archive' : 'restore'}`,
        { method: 'POST' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.categories }),
  });
}

export function useHelpMedia(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: keys.media,
    queryFn: () => api<HelpMediaRow[]>('/operator/help/media'),
  });
}

export function useUploadHelpMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api<HelpMediaRow>(`/operator/help/media?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: file,
        headers: { 'content-type': file.type || 'application/octet-stream' },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.media }),
  });
}

export function useHelpFeedbackList(
  filter: { helpful?: boolean; open?: boolean },
  enabled: boolean,
) {
  const qs = new URLSearchParams(
    Object.entries(filter)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return useQuery({
    enabled,
    queryKey: keys.feedback(filter),
    queryFn: () => api<HelpFeedbackRow[]>(`/operator/help/feedback${qs ? `?${qs}` : ''}`),
  });
}

export function useReviewHelpFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; reviewedAt: string }>(`/operator/help/feedback/${id}/review`, {
        method: 'POST',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operator', 'help', 'feedback'] }),
  });
}
