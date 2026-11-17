import type {
  ConcernCategory,
  CreditRole,
  InstructionStatus,
  MessagePriority,
  MonitorSection,
  PerformanceStatus,
  DrillMetric,
  FunnelStage,
  ReportPeriod,
  TransferStatus,
  WorkSection,
} from '@dealflow/types';
import type { MessageKey } from '@/lib/i18n';

/** Labels for the Command Center dashboards (ADR 0063). Every number names what it counts, in the card's tooltip. */

export const METRIC_LABEL = {
  leadsGenerated: 'Leads generated',
  activeCompanies: 'Active companies',
  employeesContacted: 'Employees contacted',
  emailsSent: 'Emails sent',
  responses: 'Responses received',
  positiveResponses: 'Positive responses',
  followUpsToday: 'Follow-ups due today',
  followUpsOverdue: 'Overdue follow-ups',
  followUpsPending: 'Pending follow-ups',
  rfqsReceived: 'RFQs received',
  rfqsSubmitted: 'RFQs submitted',
  rfqsWon: 'RFQs won',
  rfqsLost: 'RFQs lost',
  clientsConverted: 'Clients converted',
  clientsRejected: 'Clients rejected',
  clientConcerns: 'Client concerns',
  transfersToSenior: 'Leads transferred to seniors',
  revenue: 'Revenue generated',
  openOpportunities: 'Open opportunities',
  existingClients: 'Existing clients',
  companies: 'Companies',
  outstanding: 'Outstanding revenue',
  unassignedLeads: 'Unassigned leads',
  'stage:NEW': 'New',
  'stage:CONTACTED': 'Contacted',
  'stage:DISCUSSION': 'Discussion',
  'stage:INTERESTED': 'Interested',
  'stage:RFQ_RECEIVED': 'RFQ received',
  'stage:QUOTATION_SUBMITTED': 'Quotation submitted',
  'stage:NEGOTIATION': 'Negotiation',
  'stage:WON': 'Won',
  'stage:LOST': 'Lost',
} as const satisfies Record<DrillMetric, MessageKey>;

export const METRIC_DEFINITION: Partial<Record<DrillMetric, MessageKey>> = {
  leadsGenerated: 'Company leads created in the period.',
  activeCompanies: 'Company leads owned now whose status is not lost or on hold.',
  employeesContacted:
    'Employees reached in the period by a logged email, call, meeting or message, or a synced email.',
  emailsSent: 'Logged sent emails plus emails synced from a connected mailbox, in the period.',
  responses:
    'Logged replies and incoming calls plus synced emails received from employees, in the period.',
  positiveResponses: 'Interactions in the period marked as a positive response.',
  followUpsToday: 'Open follow-ups due today.',
  followUpsOverdue: 'Open follow-ups past their due time.',
  rfqsReceived: 'RFQs received in the period.',
  rfqsSubmitted: 'Quotations submitted in the period.',
  clientsConverted: 'Companies whose first won deal or RFQ closed in the period.',
  clientsRejected: 'Company leads moved to a rejected or not interested status in the period.',
  clientConcerns: 'Companies with a concern status or an open concern now.',
  transfersToSenior:
    'Leads moved to a manager or senior person through an approved transfer in the period.',
  revenue:
    'Revenue credited in the period: each won deal split by attribution, so nothing is counted twice.',
};

export const FUNNEL_LABEL = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  DISCUSSION: 'Discussion',
  INTERESTED: 'Interested',
  RFQ_RECEIVED: 'RFQ received',
  QUOTATION_SUBMITTED: 'Quotation submitted',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
} as const satisfies Record<FunnelStage, MessageKey>;

export const PERIOD_LABEL = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  h1: 'First half of the year',
  h2: 'Second half of the year',
  this_year: 'This year',
  last_year: 'Last year',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
  custom: 'Custom dates',
} as const satisfies Record<ReportPeriod, MessageKey>;

export const WORK_LABEL = {
  today: "Today's follow-ups",
  pending: 'Pending tasks',
  overdue: 'Overdue follow-ups',
  calls: 'Calls scheduled',
  meetings: 'Meetings scheduled',
  awaiting: 'Clients awaiting a response',
  rfqDeadlines: 'RFQ deadlines',
  concerns: 'Client concerns',
  fromManager: 'Assigned by your manager',
  reassigned: 'Reassigned to you',
} as const satisfies Record<WorkSection, MessageKey>;

export const SECTION_LABEL = {
  'exec.kpis': 'Key metrics',
  'exec.work': 'My work',
  'exec.instructions': 'Instructions for you',
  'exec.pipeline': 'My pipeline',
  'exec.performance': 'Business performance',
  'exec.revenue': 'Revenue attribution',
  'exec.transfers': 'Lead transfer requests',
  'team.kpis': 'Team metrics',
  'team.table': 'Employee performance',
  'team.compare': 'Performance comparison',
  'team.pipeline': 'Team pipeline',
  'team.monitor': 'Follow-up monitoring',
  'team.instructions': 'Instructions sent',
  'team.concerns': 'Unresolved client concerns',
  'team.revenue': 'Business generation and revenue',
} as const satisfies Record<string, MessageKey>;

export const MONITOR_LABEL = {
  teamToday: "Today's team follow-ups",
  teamOverdue: 'Overdue team follow-ups',
  teamMeetings: 'Upcoming meetings',
  teamAwaiting: 'Pending client responses',
  teamRfqDeadlines: 'RFQ deadlines',
  teamConcerns: 'Client concerns',
  unassigned: 'Unassigned leads',
  intervention: 'Leads needing senior intervention',
} as const satisfies Record<MonitorSection, MessageKey>;

export const PERFORMANCE_STATUS_LABEL = {
  ACHIEVED: 'Target achieved',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  BEHIND: 'Behind',
  NO_TARGET: 'No target set',
  INACTIVE: 'No activity',
} as const satisfies Record<PerformanceStatus, MessageKey>;

export const PERFORMANCE_STATUS_TONE: Record<PerformanceStatus, 'success' | 'primary' | 'warning' | 'critical' | 'neutral'> = {
  ACHIEVED: 'success',
  ON_TRACK: 'primary',
  AT_RISK: 'warning',
  BEHIND: 'critical',
  NO_TARGET: 'neutral',
  INACTIVE: 'neutral',
};

export const MESSAGE_PRIORITY_LABEL = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
} as const satisfies Record<MessagePriority, MessageKey>;

export const INSTRUCTION_STATUS_LABEL = {
  OPEN: 'Not acknowledged',
  ACKNOWLEDGED: 'Acknowledged',
  DONE: 'Done',
  CANCELLED: 'Withdrawn',
} as const satisfies Record<InstructionStatus, MessageKey>;

export const INSTRUCTION_STATUS_TONE: Record<InstructionStatus, 'warning' | 'primary' | 'success' | 'neutral'> = {
  OPEN: 'warning',
  ACKNOWLEDGED: 'primary',
  DONE: 'success',
  CANCELLED: 'neutral',
};

export const CONCERN_CATEGORY_LABEL = {
  GENERAL: 'Client raised a concern',
  PRICING: 'Pricing concern',
  QUALITY: 'Quality concern',
  COMMUNICATION: 'Communication concern',
  DELIVERY: 'Project delivery concern',
  PAYMENT: 'Payment concern',
  SERVICE: 'Service concern',
  NOT_INTERESTED: 'Not interested',
  REJECTED: 'Rejected',
  LOST_OPPORTUNITY: 'Lost opportunity',
} as const satisfies Record<ConcernCategory, MessageKey>;

export const SEVERITY_LABEL = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
} as const satisfies Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', MessageKey>;

export const SEVERITY_TONE = { LOW: 'neutral', MEDIUM: 'primary', HIGH: 'warning', CRITICAL: 'critical' } as const;

export const CREDIT_ROLE_LABEL = {
  LEAD_GENERATION: 'Lead generation',
  DEAL_CLOSURE: 'Deal closure',
  ACCOUNT_OWNERSHIP: 'Account ownership',
  SUPPORT: 'Support',
  MANUAL: 'Set by hand',
} as const satisfies Record<CreditRole, MessageKey>;

export const TRANSFER_STATUS_LABEL = {
  PENDING: 'Waiting for a decision',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REASSIGNED: 'Reassigned',
  CANCELLED: 'Cancelled',
} as const satisfies Record<TransferStatus, MessageKey>;

export const TRANSFER_STATUS_TONE: Record<
  TransferStatus,
  'warning' | 'success' | 'critical' | 'primary' | 'neutral'
> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'critical',
  REASSIGNED: 'primary',
  CANCELLED: 'neutral',
};

export const PAYMENT_STATUS_LABEL = {
  NOT_DUE: 'Not due yet',
  PENDING: 'Payment pending',
  PARTIAL: 'Partly paid',
  PAID: 'Paid',
  OVERDUE: 'Payment overdue',
} as const satisfies Record<'NOT_DUE' | 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE', MessageKey>;
