/**
 * Every word, number, link and image on the page lives here, so the web team can edit copy without touching layout.
 *
 * Honesty rules this page follows (keep them when editing):
 *  - Product facts below are true of the SampForce build as of November 2026 (see the repository docs).
 *  - Competitor facts come only from vendors' own pricing pages, with the access date shown on the page.
 *    Re-check them before each publish, and have legal review comparative claims (docs/FEATURE_MATRIX.md §3).
 *    Set `showNamedComparison` to false to publish without naming other vendors.
 *  - Never describe a competitor as lacking something: say what their page states.
 */
import agents from './assets/screens/agents-dark.webp';
import appearance from './assets/screens/appearance-dark.webp';
import automation from './assets/screens/automation-dark.webp';
import commandDark from './assets/screens/command-center-dark.webp';
import commandLight from './assets/screens/command-center-light.webp';
import dealsDark from './assets/screens/deals-dark.webp';
import dealsLight from './assets/screens/deals-light.webp';
import flow from './assets/screens/flow-dark.webp';
import forecastDark from './assets/screens/forecasting-dark.webp';
import forecastLight from './assets/screens/forecasting-light.webp';
import galaxy from './assets/screens/galaxy-dark.webp';
import gamification from './assets/screens/gamification-dark.webp';
import globe from './assets/screens/globe-dark.webp';
import integrations from './assets/screens/integrations-dark.webp';
import leads from './assets/screens/leads-dark.webp';
import mobileCommand from './assets/screens/mobile-command-center-dark.webp';
import mobileDeals from './assets/screens/mobile-deals-dark.webp';
import revenue from './assets/screens/revenue-dark.webp';
import securityShot from './assets/screens/security-dark.webp';
import templatesDark from './assets/screens/templates-dark.webp';
import templatesLight from './assets/screens/templates-light.webp';

export const screens = {
  agents, appearance, automation, commandDark, commandLight, dealsDark, dealsLight, flow, forecastDark, forecastLight,
  galaxy, gamification, globe, integrations, leads, mobileCommand, mobileDeals, revenue, security: securityShot, templatesDark, templatesLight,
};

/** Where the buttons go. Point these at the live app and your contact page. */
export const links = {
  signup: 'https://app.sampforce.com/signup',
  login: 'https://app.sampforce.com/login',
  pricing: 'https://app.sampforce.com/pricing',
  contactSales: 'mailto:sales@sampledge.com?subject=SampForce%20demo',
  sampledge: 'https://www.sampledge.com',
};

export const showNamedComparison = true;

export const nav = [
  { label: 'Platform', href: '#loop' },
  { label: 'Features', href: '#features' },
  { label: 'AI', href: '#ai' },
  { label: 'Why SampForce', href: '#why' },
  { label: 'Pricing', href: '#pricing' },
];

export const hero = {
  eyebrow: 'Introducing SampForce by Sampledge',
  words: ['Sell.', 'Close.', 'Grow.'],
  sub: 'The AI-native revenue platform. Leads, deals, automation, quotes and revenue intelligence in one workspace, with AI that shows its reasoning, stays inside each person’s permissions and asks before it acts.',
  primary: 'Start free',
  secondary: 'See it in motion',
  micro: ['Free for 2 users', 'No card needed', 'SSO on every plan'],
  floating: [
    { k: 'Deal won', v: '$48,200', tone: 'amber' },
    { k: 'Lead score', v: '92 / 100', tone: 'cyan' },
    { k: 'Approval asked', v: 'Discount 12%', tone: 'violet' },
    { k: 'Forecast', v: '$739,900', tone: 'coral' },
  ],
};

export const marquee = [
  'Leads', 'Deals', 'Pipelines', 'Email sequences', 'Quotes', 'Proposals', 'Contracts', 'Forecasting', 'AI agents',
  'Automation Studio', 'Relationship Galaxy', 'Revenue Globe', 'Email Finder', 'Browser extension', 'Website visitors',
  'Campaigns', 'Customer success', 'Gamification', 'SSO + SCIM', 'Two-step sign-in', 'Five languages',
];

export const stats = [
  { value: 10, suffix: '', label: 'AI agents, each with its own switch' },
  { value: 5, suffix: '', label: 'languages, Arabic right to left' },
  { value: 10, suffix: '', label: 'ready bid templates' },
  { value: 0, prefix: '$', suffix: '', label: 'onboarding fee, on every self-service plan' },
];

export const loop = [
  {
    key: 'capture',
    step: '01',
    title: 'Capture',
    head: 'Every lead, from every door.',
    body: 'Website forms and anonymous visitors, a one-click browser extension, an email finder that honours robots.txt, CSV import with duplicate checks. Leads are scored the moment they land.',
    points: ['Browser extension and Email Finder', 'Website visitor tracking with consent modes', 'AI lead qualification'],
    image: leads,
    color: 'var(--cyan)',
  },
  {
    key: 'engage',
    step: '02',
    title: 'Engage',
    head: 'Follow up on autopilot, never off script.',
    body: 'Email sequences from your own Gmail or Outlook, a drag-and-drop email designer, meetings, Slack, Teams, SMS and WhatsApp. Automations are simulated before they run, so nothing surprises a customer.',
    points: ['Sequences with tracking and unsubscribe', 'Visual Automation Studio with simulation', 'Slack, Teams, Zoom, Twilio, WhatsApp'],
    image: automation,
    color: 'var(--violet)',
  },
  {
    key: 'close',
    step: '03',
    title: 'Close',
    head: 'From handshake to signature, in one place.',
    body: 'Kanban pipelines with deal health, Quick Bid Studio with ten templates, proposals with view tracking, contracts, DocuSign, and card payments into your own Stripe or Razorpay account.',
    points: ['Deal health and next best actions', 'Quotes, proposals and contracts', 'DocuSign and card payments'],
    image: dealsDark,
    color: 'var(--coral)',
  },
  {
    key: 'grow',
    step: '04',
    title: 'Grow',
    head: 'See where revenue comes from, and where it is going.',
    body: 'Forecasts with scenarios, revenue intelligence, renewals and churn risk, plus immersive views: a 3D Relationship Galaxy, a Revenue Globe and a pipeline replay you can scrub through time.',
    points: ['Forecasting with best, worst and weighted cases', 'Customer success and renewals', 'Galaxy, Globe, Flow and Replay views'],
    image: forecastDark,
    color: 'var(--amber)',
  },
];

export const features = [
  { title: 'Command Center', body: 'Live KPIs with the formula behind every number, next best actions and a weekly digest.', image: commandDark, size: 'xl', tag: 'Home' },
  { title: 'Relationship Galaxy', body: 'Your accounts, people and deals as a 3D network you can fly through.', image: galaxy, size: 'tall', tag: '3D' },
  { title: 'Forecasting', body: 'Committed, best case and weighted pipeline against target, by salesperson.', image: forecastLight, size: 'md', tag: 'Revenue' },
  { title: 'Bid templates', body: 'Ten designed proposal templates. Pick one, add a price book, send.', image: templatesLight, size: 'md', tag: 'Quotes' },
  { title: 'Revenue Globe', body: 'Open pipeline and won revenue by country, on a globe or a flat map.', image: globe, size: 'md', tag: '3D' },
  { title: 'AI Agents', body: 'Ten agents with allowances, cost caps, an audit trail and a kill switch.', image: agents, size: 'md', tag: 'AI' },
  { title: 'Pipeline flow', body: 'Watch deals move between stages, with conversion and time in stage.', image: flow, size: 'wide', tag: 'Analytics' },
  { title: 'Theme Studio', body: 'Thirteen themes, your brand colour, density and motion levels, all contrast-checked.', image: appearance, size: 'md', tag: 'Design' },
  { title: 'Workspace security', body: 'Two-step sign-in, OIDC single sign-on and SCIM provisioning on every plan.', image: securityShot, size: 'md', tag: 'Trust' },
];

export const ai = {
  title: 'AI that shows its work,',
  accent: 'and asks before it acts.',
  body: 'SampForce Copilot reads your CRM with your permissions, not more. Reading runs at once; anything that changes data waits for your approval. Every model call is logged with its cost against a published monthly allowance, and an admin can switch AI off for the whole workspace in one click.',
  chat: [
    { who: 'you', text: 'Which deals over $50k are at risk this month, and why?' },
    { who: 'tool', text: 'search_deals · health < 40 · amount > 50,000 · close ≤ 30 Nov' },
    { who: 'ai', text: '3 deals. Helix Pharma · Segmentation refresh ($126k) has had no activity for 14 days and its close date passed. Want me to draft a follow-up and move the date?' },
    { who: 'approve', text: 'Update close date + create task' },
  ],
  agents: ['Copilot', 'Lead Qualification', 'Deal Intelligence', 'Meeting Notes', 'Proposal Draft', 'Workflow Builder', 'Forecast Explainer', 'Email Assistant', 'Voice Assistant', 'Retention Advisor'],
  pillars: [
    { t: 'Reasoning on screen', d: 'Scores and recommendations list the signals and records behind them.' },
    { t: 'Approval tiers', d: 'Read-only answers run; changes queue for a person to approve.' },
    { t: 'Published allowance', d: 'AI credits per plan, visible to admins. Nothing is charged automatically.' },
    { t: 'Kill switch', d: 'Turn one agent or all AI off. Rule-based scores keep working.' },
  ],
};

export const immersive = [
  { title: 'Relationship Galaxy', body: 'Companies, people and deals as a living 3D network.', image: galaxy },
  { title: 'Revenue Globe', body: 'Pipeline value by country, spinning in your hands.', image: globe },
  { title: 'Pipeline flow', body: 'Stage-to-stage movement with real conversion rates.', image: flow },
  { title: 'Revenue intelligence', body: 'Won by month, funnel, owner and product.', image: revenue },
  { title: 'Sales gamification', body: 'Points, badges and fair leaderboards for the team.', image: gamification },
];

export const why = {
  title: 'Fair by design.',
  sub: 'Most CRMs earn on the fine print: onboarding fees, seat minimums, metered AI and premium add-ons for security. SampForce publishes everything on one rate card.',
  pillars: [
    { big: '$0', t: 'Onboarding fee', d: 'Self-service plans have no setup charge and no seat minimum below Business.' },
    { big: 'Free', t: 'SSO and SCIM on every plan', d: 'Single sign-on and user provisioning are not an upgrade lever. Even on Free.' },
    { big: '50→3k', t: 'AI credits per seat, printed', d: 'Each plan states its AI allowance. When it runs out, AI pauses; no surprise bill.' },
    { big: '2', t: 'Users free, forever', d: 'Start with two users and no card. Upgrade when the team grows.' },
    { big: '5', t: 'Languages, with Arabic RTL', d: 'English, Español, Français, Deutsch and العربية, including Arabic PDFs.' },
    { big: 'Your server', t: 'Self-host option', d: 'Run SampForce on your own Ubuntu server with one Docker Compose package.' },
  ],
  /** Each row: what SampForce does, and what one vendor's own pricing page stated on the access date. */
  comparison: [
    { topic: 'Onboarding', us: 'No onboarding fee on self-service plans', them: 'HubSpot Sales Hub: required one-time onboarding, $1,500 (Professional) and $3,500 (Enterprise)' },
    { topic: 'AI agents', us: 'Ten agents included, with a monthly AI credit allowance on every plan', them: 'Salesforce Sales Cloud: Agentforce for Sales available for purchase on Core and Advanced, from $125/user/month' },
    { topic: 'AI metering', us: 'Allowance printed per plan; AI pauses when it is used up', them: 'Microsoft Dynamics 365 Sales: agents require Copilot Credits, bought pay-as-you-go or pre-purchased' },
    { topic: 'Seat minimum', us: 'None below the Business plan', them: 'monday CRM: minimum of 3 seats' },
    { topic: 'Entry price', us: '$8 per user per month ($6 billed annually); Free for 2 users', them: 'Pipedrive Lite: US$14 per seat per month, billed annually' },
  ],
  source: 'Competitor details are quoted from each vendor’s own pricing page, accessed 30 October 2026. Prices and packaging change often; check the vendor’s current page.',
};

export const security = {
  title: 'Enterprise-grade, on day one.',
  items: [
    { t: 'Tenant isolation in the database', d: 'PostgreSQL row-level security on every table; the app role cannot bypass it.' },
    { t: 'Two-step sign-in', d: 'Authenticator apps, recovery codes, lockout and device sign-out.' },
    { t: 'Single sign-on + SCIM', d: 'OpenID Connect sign-in and SCIM 2.0 provisioning, on every plan.' },
    { t: 'Roles and audit trail', d: 'Custom roles with fine-grained permissions and a full audit log.' },
    { t: 'Encrypted secrets', d: 'Integration keys sealed at rest with key rotation scripts.' },
    { t: 'Accessible by default', d: 'WCAG 2.2 AA checks in light, dark and Arabic on every key page.' },
  ],
};

export const integrationList = [
  'Gmail', 'Google Calendar', 'Outlook', 'Microsoft 365', 'Slack', 'Microsoft Teams', 'Zoom', 'DocuSign', 'Stripe', 'Razorpay',
  'Twilio SMS', 'WhatsApp', 'Zapier', 'Apollo.io', 'Hunter.io', 'Deepgram', 'Claude AI', 'Webhooks', 'REST API', 'SMTP',
];

export const languages = [
  { code: 'EN', name: 'English', line: 'Sell. Close. Grow.' },
  { code: 'ES', name: 'Español', line: 'Vende. Cierra. Crece.' },
  { code: 'FR', name: 'Français', line: 'Vendez. Concluez. Grandissez.' },
  { code: 'DE', name: 'Deutsch', line: 'Verkaufen. Abschließen. Wachsen.' },
  { code: 'AR', name: 'العربية', line: 'بِع. أغلِق. انمُ.', rtl: true },
];

export const plans = [
  { name: 'Free', monthly: 0, annual: 0, who: 'Individuals', note: 'Up to 2 users', points: ['1 pipeline', '50 AI credits / seat', 'SSO + SCIM'] },
  { name: 'Launch', monthly: 8, annual: 6, who: 'Startups', points: ['3 pipelines', '200 AI credits / seat', '2,000 automation runs'] },
  { name: 'Growth', monthly: 15, annual: 12, who: 'Growing teams', featured: true, points: ['10 pipelines', '500 AI credits / seat', 'API access'] },
  { name: 'Professional', monthly: 29, annual: 23, who: 'Advanced sales teams', points: ['25 pipelines', '1,000 AI credits / seat', '50,000 automation runs'] },
  { name: 'Business', monthly: 49, annual: 39, who: 'Established businesses', points: ['50 pipelines', '2,000 AI credits / seat', '150,000 automation runs'] },
  { name: 'Enterprise', monthly: 79, annual: 65, who: 'Large organizations', points: ['Unlimited pipelines', '3,000 AI credits / seat', '500,000 automation runs'] },
];
export const pricingNote = 'USD per user per month, excluding taxes. Enterprise Plus: custom pricing for global enterprises.';

export const finalCta = {
  title: 'Put a force behind every deal.',
  body: 'Start free in minutes. Two users, no card, no onboarding fee.',
};

export const mobile = { mobileCommand, mobileDeals, commandLight, dealsLight, templatesDark };
