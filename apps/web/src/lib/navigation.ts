import {
  Activity,
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  CalendarDays,
  ContactRound,
  CreditCard,
  FileSignature,
  FileText,
  Handshake,
  HeartHandshake,
  KanbanSquare,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  Mail,
  Megaphone,
  Plug,
  Send,
  Settings,
  ShieldCheck,
  Store,
  TrendingUp,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react';

export type ModuleStatus = 'available' | 'planned';

export interface ModuleDef {
  slug: string;
  label: string;
  icon: LucideIcon;
  group: 'Workspace' | 'Engage' | 'Intelligence' | 'Revenue' | 'Organization';
  status: ModuleStatus;
  /** Roadmap phase (docs/IMPLEMENTATION_PLAN.md) in which the module ships. */
  phase: number;
  summary: string;
  /** Planned capabilities, shown on the module page until it ships. */
  capabilities: string[];
}

/** The 26 sidebar modules. Every entry routes to a real page: either the module or its roadmap. */
export const MODULES: ModuleDef[] = [
  { slug: '', label: 'Command Center', icon: LayoutDashboard, group: 'Workspace', status: 'available', phase: 1,
    summary: 'Live KPIs, pipeline health and team activity in one view.', capabilities: [] },
  { slug: 'leads', label: 'Leads', icon: UserPlus, group: 'Workspace', status: 'available', phase: 2,
    summary: 'Capture, deduplicate, score, route and convert leads.',
    capabilities: ['Web form, CSV/Excel and API capture', 'Duplicate detection and merge', 'Territory, round-robin and workload routing', 'BANT and MEDDICC qualification frameworks', 'Lead lifecycle and conversion analytics'] },
  { slug: 'contacts', label: 'Contacts', icon: ContactRound, group: 'Workspace', status: 'available', phase: 2,
    summary: 'People you sell to, with a unified communication timeline.',
    capabilities: ['Custom fields', 'Consent preferences', 'Communication timeline', 'Import and export'] },
  { slug: 'companies', label: 'Companies', icon: Building2, group: 'Workspace', status: 'available', phase: 2,
    summary: 'Organisations, parent-child hierarchies and buying committees.',
    capabilities: ['Account hierarchy', 'Buying committee and stakeholder mapping', 'Relationship health scoring', 'AI account briefings (later phase)'] },
  { slug: 'deals', label: 'Deals', icon: Handshake, group: 'Workspace', status: 'available', phase: 2,
    summary: 'Opportunities with line items, approvals and win/loss analysis.',
    capabilities: ['Kanban, list, table, timeline and calendar views', 'Product line items', 'Competitor tracking and loss reasons', 'Bulk updates and cloning', 'AI deal health'] },
  { slug: 'pipelines', label: 'Pipelines', icon: KanbanSquare, group: 'Workspace', status: 'available', phase: 2,
    summary: 'Multiple configurable pipelines with stage probabilities.',
    capabilities: ['Custom stages and probabilities', 'Stage-based automation (Phase 3)', 'Plan-based pipeline limits'] },
  { slug: 'accounts', label: 'Accounts', icon: Briefcase, group: 'Workspace', status: 'available', phase: 2,
    summary: 'Customer accounts with ownership, segmentation and account-level forecasting.',
    capabilities: ['Account ownership and segmentation', 'Account-based selling views', 'Document storage'] },
  { slug: 'activities', label: 'Sales Activities', icon: Activity, group: 'Engage', status: 'available', phase: 2,
    summary: 'Calls, emails, meetings, notes and tasks.',
    capabilities: ['Task management with reminders', 'Activity logging from any record', 'Team activity reporting'] },
  { slug: 'communication', label: 'Email & Communication', icon: Mail, group: 'Engage', status: 'available', phase: 3,
    summary: 'Email with your contacts and leads, synced from Gmail or Microsoft 365.',
    capabilities: ['Gmail and Microsoft 365 sync (requires OAuth app credentials)', 'Send from your own mailbox', 'Templates and shared inboxes (later phase)'] },
  { slug: 'meetings', label: 'Meetings', icon: CalendarDays, group: 'Engage', status: 'available', phase: 3,
    summary: 'Customer meetings synced from Google Calendar or Outlook.',
    capabilities: ['Google and Microsoft calendar sync', 'Scheduling links (later phase)', 'AI summaries of pasted meeting notes'] },
  { slug: 'agents', label: 'AI Agents', icon: Bot, group: 'Intelligence', status: 'available', phase: 4,
    summary: 'The Digital Sales Team: permissioned AI agents with approvals and audit trails.',
    capabilities: ['Provider-independent AI gateway', 'Tool allowlists and approval checkpoints', 'Cost limits and kill switches', 'Execution history and evaluations'] },
  { slug: 'automation', label: 'Automation Studio', icon: Workflow, group: 'Intelligence', status: 'available', phase: 3,
    summary: 'Visual workflow builder with simulation, versioning and approvals.',
    capabilities: ['Triggers, conditions and actions', 'Branching and delays', 'Simulation mode and execution logs', 'AI workflow builder'] },
  { slug: 'marketing', label: 'Marketing', icon: Megaphone, group: 'Engage', status: 'available', phase: 5,
    summary: 'Segments and hosted lead forms with recorded consent, connected to sales records.',
    capabilities: ['Segment builder with consent-aware export', 'Hosted, embeddable lead forms', 'Visual journeys and email sending (later phase)'] },
  { slug: 'campaigns', label: 'Campaigns', icon: Send, group: 'Engage', status: 'available', phase: 5,
    summary: 'Campaign tracking with first-touch attribution to leads, deals and revenue.',
    capabilities: ['First-touch attribution', 'Cost per lead and won ÷ budget', 'A/B testing (later phase)'] },
  { slug: 'quotes', label: 'Quotes & Proposals', icon: FileText, group: 'Revenue', status: 'available', phase: 5,
    summary: 'Catalogue, price books and versioned quotes with discount approvals and PDFs.',
    capabilities: ['Price books per currency', 'Discount approvals (no self-approval)', 'Quote versions and PDF download'] },
  { slug: 'contracts', label: 'Contracts', icon: FileSignature, group: 'Revenue', status: 'available', phase: 5,
    summary: 'Contract register with recorded signatures, renewals and reminders.',
    capabilities: ['Renewal reminders and expiry', 'Linked renewals', 'E-signature provider adapters (later phase, needs provider credentials)'] },
  { slug: 'revenue', label: 'Revenue Intelligence', icon: LineChart, group: 'Intelligence', status: 'available', phase: 5,
    summary: 'Quarterly revenue analytics computed from your records, with targets and exchange rates.',
    capabilities: ['Won revenue by owner, source and product', 'Win rate, velocity and loss reasons', 'Forecast against actual'] },
  { slug: 'forecasting', label: 'Forecasting', icon: TrendingUp, group: 'Intelligence', status: 'available', phase: 4,
    summary: 'Weighted, historical and scenario forecasts, clearly labelled as projections.',
    capabilities: ['Best/base/worst scenarios', 'Reproducible snapshots and comparisons', 'AI explanations of what changed'] },
  { slug: 'customer-success', label: 'Customer Success', icon: HeartHandshake, group: 'Revenue', status: 'available', phase: 5,
    summary: 'Explained health scores, escalations, renewals and churn-risk alerts.',
    capabilities: ['Rule-based health scoring', 'Escalations', 'Churn-risk alerts', 'Onboarding plans (later phase)'] },
  { slug: 'reports', label: 'Reports & Analytics', icon: BarChart3, group: 'Intelligence', status: 'available', phase: 7,
    summary: 'Report builder, dashboards, Relationship Galaxy, Revenue Globe, pipeline flow and replays.',
    capabilities: ['Report builder over eight record types', 'Custom dashboards', 'CSV export (audited)', '3D views with 2D fallbacks', 'Scheduled exports (later phase)'] },
  { slug: 'team', label: 'Team Management', icon: Users, group: 'Organization', status: 'available', phase: 1,
    summary: 'Members, roles and permissions.', capabilities: [] },
  { slug: 'integrations', label: 'Integrations', icon: Plug, group: 'Organization', status: 'available', phase: 1,
    summary: 'Connection status for every integration.', capabilities: [] },
  { slug: 'marketplace', label: 'Marketplace', icon: Store, group: 'Organization', status: 'planned', phase: 8,
    summary: 'Third-party apps and templates.',
    capabilities: ['Integration listings', 'Workflow and dashboard templates', 'Developer SDK'] },
  { slug: 'billing', label: 'Billing', icon: CreditCard, group: 'Organization', status: 'available', phase: 1,
    summary: 'Plan, seats, usage, checkout and invoices.', capabilities: [] },
  { slug: 'settings', label: 'Settings', icon: Settings, group: 'Organization', status: 'available', phase: 1,
    summary: 'Workspace and personal preferences.', capabilities: [] },
  { slug: 'administration', label: 'Administration', icon: ShieldCheck, group: 'Organization', status: 'available', phase: 1,
    summary: 'Audit log, support access and governance controls.', capabilities: [] },
];

export const PHASE_NAMES: Record<number, string> = {
  1: 'Product Foundation',
  2: 'Core CRM',
  3: 'Automation and Communication',
  4: 'AI Intelligence',
  5: 'Advanced Revenue Platform',
  6: 'SaaS Commercialization',
  7: 'Immersive Experience',
  8: 'Enterprise Readiness',
};

export function moduleHref(m: ModuleDef): string {
  return m.slug ? `/app/${m.slug}` : '/app';
}

export function findModule(slug: string): ModuleDef | undefined {
  return MODULES.find((m) => m.slug === slug);
}
