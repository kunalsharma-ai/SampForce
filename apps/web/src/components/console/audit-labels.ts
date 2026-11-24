import type { ConsoleActivityItem } from '@dealflow/types';
import { formatMinor } from '@/lib/billing';

/** Readable names for platform audit actions (ADR 0074, C3). Unknown actions fall back to their words. */
const ACTIONS: Record<string, string> = {
  'client.created': 'Created a client',
  'client.viewed': 'Opened a client',
  'clients.listed': 'Listed clients',
  'client.subscription_changed': 'Changed a subscription',
  'client.renewed': 'Renewed a subscription',
  'client.state_changed': 'Changed a client’s status',
  'client.authority_changed': 'Changed Super Workspace permissions',
  'client.administrator_invited': 'Invited a client administrator',
  'client.subscription_extended': 'Extended a subscription',
  'client.administrators_emailed': 'Emailed a client’s administrators',
  'clients.bulk': 'Ran a bulk action on clients',
  'clients.exported': 'Exported the clients list',
  'client.profile_updated': 'Changed a client’s company details',
  'client.health_measured': 'Measured a client’s health score',
  'settings.health_updated': 'Changed the health score weights',
  'client.logo_set': 'Changed a client’s logo',
  'client.logo_removed': 'Removed a client’s logo',
  'location.city_added': 'Added a city',
  'location.city_renamed': 'Renamed a city',
  'location.city_removed': 'Removed an added city',
  'location.city_rename_undone': 'Undid a city rename',
  'tenant.suspended': 'Suspended a client',
  'tenant.reactivated': 'Reactivated a client',
  'tenant.features_overridden': 'Changed a client’s features',
  'tenant.plan_overridden': 'Changed a client’s plan',
  'tenant.offline_payment_recorded': 'Recorded a payment',
  'tenant.invoice_voided': 'Voided an invoice',
  'plan.created': 'Created a plan',
  'plan.definition_changed': 'Changed a plan',
  'settings.payment_instructions_updated': 'Changed payment instructions',
  'provider_key.set': 'Saved a provider key',
  'provider_key.cleared': 'Removed a provider key',
  'provider_key.imported': 'Imported a provider key',
  'provider.checked': 'Tested a provider',
  'operator.login': 'Signed in',
  'operator.login_failed': 'Failed to sign in',
  'operator.invited': 'Invited an operator',
  'operator.reinvited': 'Sent a new invitation',
  'operator.joined': 'Joined the Console',
  'operator.role_changed': 'Changed an operator’s role',
  'operator.disabled': 'Disabled an operator',
  'operator.enabled': 'Enabled an operator',
  'operator.renamed': 'Renamed an operator',
  'operator.reset_link_issued': 'Issued a password link',
  'operator.reset_requested': 'Asked for a password reset',
  'operator.password_reset': 'Reset their password',
  'operator.mfa_setup_started': 'Started two-step verification setup',
  'operator.mfa_enabled': 'Turned on two-step verification',
  'operator.mfa_disabled': 'Turned off two-step verification',
  'operator.mfa_reset': 'Reset an operator’s two-step verification',
  'operator.recovery_codes_regenerated': 'Made new recovery codes',
  'operator.session_ended': 'Ended a session',
  'operator.sessions_ended': 'Ended sessions',
  'operator_role.created': 'Created a role',
  'operator_role.updated': 'Changed a role',
  'operator_role.deleted': 'Deleted a role',
  'console.security_policy_changed': 'Changed the security policy',
  'console.searched': 'Searched the Console',
  'audit.exported': 'Exported the audit log',
  'support_ticket.answered': 'Answered a ticket',
  'support_ticket.updated': 'Updated a ticket',
  'support_ticket.attachment_added': 'Attached a file to a ticket',
  'support_chat.opened': 'Opened a support line',
  'support_chat.replied': 'Replied in support chat',
  'support_chat.attachment_sent': 'Sent a file in support chat',
  'support_chat.message_edited': 'Edited a support chat message',
  'support_chat.message_removed': 'Removed a support chat message',
  'mobile.limits': 'Changed mobile limits',
  'help_settings.client_updated': 'Changed a client’s Help Center',
};

export function actionLabel(action: string): string {
  if (ACTIONS[action]) return ACTIONS[action]!;
  const words = action.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const TARGET_LABEL: Record<string, string> = {
  client: 'Client',
  operator: 'Operator',
  role: 'Role',
  plan: 'Plan',
  provider: 'Provider',
  provider_key: 'Provider key',
  setting: 'Setting',
  ticket: 'Support ticket',
  support_chat: 'Support chat',
  help_article: 'Help article',
  help_category: 'Help category',
  help_media: 'Help media',
  help_feedback: 'Help feedback',
  audit_log: 'Audit log',
  location: 'Location',
};

export const targetLabel = (type: string) => TARGET_LABEL[type] ?? type;

const money = (cents: unknown, currency: unknown) => (typeof cents === 'number' && typeof currency === 'string' ? formatMinor(cents, currency) : '');

/** One line for an activity item, without the client (shown beside it). */
export function activitySentence(i: ConsoleActivityItem): string {
  const d = i.data;
  switch (i.kind) {
    case 'client.joined':
      return 'Joined SampForce';
    case 'workspace.created':
      return `New ${d.level === 'MANAGER' ? 'Manager' : 'Executive'} Workspace: ${d.name}`;
    case 'invoice.issued':
      return `Invoice ${d.number ?? ''} issued for ${money(d.cents, d.currency)}`.replace('  ', ' ');
    case 'invoice.paid':
      return `Paid invoice ${d.number ?? ''} (${money(d.cents, d.currency)})`.replace('  ', ' ');
    case 'subscription.past_due':
      return `Payment failed on the ${d.plan} plan`;
    case 'ticket.submitted':
      return `${d.escalated ? 'Escalated' : 'Sent'} ticket #${d.number} to SampForce support: ${d.subject}`;
    case 'signin.unusual':
      return `Unusual sign-in for ${d.email}${d.reason ? `: ${d.reason}` : ''}`;
    case 'operator.action':
      return `${i.operator?.name ?? 'An operator'}: ${actionLabel(String(d.action))}${d.target ? ` (${d.target})` : ''}`;
  }
}

export const CATEGORY_LABEL = { clients: 'Clients', workspaces: 'Workspaces', billing: 'Billing', support: 'Support', security: 'Security', console: 'Operator actions' } as const;
