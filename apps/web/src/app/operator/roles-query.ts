'use client';

import type { OperatorRoleRow } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const OPERATOR_ROLES_KEY = ['operator', 'roles'] as const;

/** The built-in and custom Console roles with their permissions and operator counts (ADR 0074). */
export function useOperatorRoles(enabled = true) {
  return useQuery({ enabled, queryKey: OPERATOR_ROLES_KEY, queryFn: () => api<OperatorRoleRow[]>('/operator/roles') });
}
