'use client';

import type { MoodInput, MyProfile, MyProfileInput, PersonCard, PersonProfile } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { api } from './api';

/** Everyone's photo, headline and mood in this workspace (ADR 0087), shared by every avatar on the page. */
export function usePeopleCards() {
  // Only workspace pages have a workspace's people; the Console and public pages show initials.
  const inWorkspace = (usePathname() ?? '').startsWith('/app');
  return useQuery({
    enabled: inWorkspace,
    queryKey: ['people', 'cards'],
    queryFn: () => api<PersonCard[]>('/people/cards'),
    staleTime: 60_000,
    refetchInterval: 120_000,
    select: (rows) => new Map(rows.map((r) => [r.id, r])),
  });
}

export function useMyProfile() {
  return useQuery({ queryKey: ['me', 'profile'], queryFn: () => api<MyProfile>('/me/profile') });
}

export function usePersonProfile(userId: string | null) {
  return useQuery({ queryKey: ['people', 'profile', userId], queryFn: () => api<PersonProfile>(`/people/${userId}/profile`), enabled: !!userId, staleTime: 30_000 });
}

/** After any change to my own profile: my profile, the session (name, photo) and everyone's avatars. */
function useRefresh() {
  const qc = useQueryClient();
  return (p: MyProfile) => {
    qc.setQueryData(['me', 'profile'], p);
    void qc.invalidateQueries({ queryKey: ['me'] });
    void qc.invalidateQueries({ queryKey: ['people'] });
  };
}

export function useSaveProfile() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (input: MyProfileInput) => api<MyProfile>('/me/profile', { method: 'PUT', json: input }), onSuccess: refresh });
}

export function useSetMood() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: MoodInput | null) => (input ? api<MyProfile>('/me/mood', { method: 'PUT', json: input }) : api<MyProfile>('/me/mood', { method: 'DELETE' })),
    onSuccess: refresh,
  });
}

/** Square, 512 pixels, JPEG: the size the phone app uploads too. */
export const PHOTO_SIZE = 512;

export async function uploadPhoto(blob: Blob): Promise<{ photoUrl: string }> {
  return api('/me/photo', { method: 'PUT', body: blob, headers: { 'content-type': 'image/jpeg' } });
}

export async function removePhoto(): Promise<void> {
  await api('/me/photo', { method: 'DELETE' });
}

export const initialsOf = (name: string | null | undefined) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';
