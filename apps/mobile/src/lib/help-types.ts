import type { SupportTicketStatus } from '@dealflow/types';

/** What GET /help sends (apps/api/src/support/help.controller.ts), already narrowed to the person and translated. */
export interface HelpResponse {
  language: string;
  level: string;
  categories: { id: string; icon: string; tone: number; title: string; description: string }[];
  faqs: { id: string; category: string; question: string; answer: string; guide: string | null }[];
  guides: { id: string; category: string; href: string | null; title: string; what: string; how: string; where: string; sections: { id: string; title: string; what: string }[] }[];
  results: { kind: 'faq' | 'guide'; id: string }[] | null;
}

export const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  IN_PROGRESS: 'In progress',
  AWAITING_USER: 'Waiting for you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const HANDLER_LABEL: Record<string, string> = {
  MANAGER: 'Your manager',
  SUPER: 'Your Super Workspace',
  CONSOLE: 'SampForce support',
};
