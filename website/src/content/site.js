/**
 * ALL PAGE TEXT LIVES HERE.
 *
 * Marketing and content edits should only need this file (and the images in src/assets/media).
 * Every claim below is backed by the shipped product or by the sources listed in docs/CONTENT_SOURCES.md.
 * Read that file before adding numbers or competitor statements.
 */

export const site = {
  brand: {
    name: 'SampForce',
    owner: 'Sampledge',
    tagline: 'Sell. Close. Grow.',
    oneLiner: 'The AI-native revenue platform by Sampledge',
  },

  // Where the buttons go. Change these to the real URLs before going live.
  links: {
    demo: 'mailto:sales@sampledge.com?subject=SampForce%20demo',
    signup: '#pricing',
    contact: 'mailto:sales@sampledge.com',
    sampledge: 'https://www.sampledge.com',
    privacy: '#',
    terms: '#',
  },

  // Turn off to hide the competitor price chart (needs re-verification and legal review: see docs/CONTENT_SOURCES.md).
  showCompetitorPrices: true,

  nav: [
    { label: 'Platform', href: '#journey' },
    { label: 'Features', href: '#features' },
    { label: 'AI agents', href: '#agents' },
    { label: 'Why SampForce', href: '#difference' },
    { label: 'Tour', href: '#tour' },
    { label: 'Pricing', href: '#pricing' },
  ],

  hero: {
    kicker: 'New from Sampledge',
    titleTop: 'Revenue,',
    titleAccent: 'fully charged.',
    sub: 'SampForce puts your CRM, outreach, automation, AI agents, quotes and revenue intelligence in one workspace, so every lead turns into momentum and every deal moves closer to closed.',
    primaryCta: 'Book a live demo',
    secondaryCta: 'Take the tour',
    cycle: ['Capture', 'Engage', 'Automate', 'Predict', 'Close', 'Grow'],
    proof: ['SSO + SCIM on every plan, Free included', 'AI allowance printed on every plan', 'No onboarding fee on self-service plans'],
    // Illustrative activity chips around the hero dashboard (they show the kind of events SampForce records).
    pulses: [
      { icon: 'spark', tone: 'gold', title: 'Copilot proposed a follow-up', meta: 'Waiting for your approval' },
      { icon: 'arrow', tone: 'ember', title: 'Deal moved to Negotiation', meta: 'Weighted pipeline updated' },
      { icon: 'target', tone: 'volt', title: 'Lead score 87 · Hot', meta: 'Explained by 5 signals' },
      { icon: 'check', tone: 'mint', title: 'Quote accepted', meta: 'Contract drafted automatically' },
    ],
  },

  marquee: [
    'Leads & contacts', 'Kanban pipelines', 'Email sequences', 'Chrome lead capture', 'Email finder', 'Prospect lists',
    'Automation Studio', 'AI Copilot', '10 AI agents', 'Lead scoring', 'Deal health', 'Forecasting',
    'Quick Bid Studio', 'Quotes & proposals', 'Contracts', 'Customer success', 'Client portal', 'Website visitors',
    'Relationship Galaxy', 'Revenue Globe', 'Pipeline replay', 'Territories', 'Gamification', 'Voice to CRM',
    'Slack', 'Microsoft Teams', 'Zoom', 'DocuSign', 'WhatsApp', 'Twilio SMS', 'Zapier', 'SSO + SCIM', '5 languages',
  ],

  journey: {
    eyebrow: 'One current, end to end',
    title: 'From first click to *renewal*, without changing tools',
    sub: 'Most sales stacks are a relay race between apps. In SampForce the same record carries the charge the whole way: one timeline, one data model, one place to look.',
    stages: [
      {
        key: 'capture', label: 'Capture', color: 'volt', media: 'leads',
        title: 'Find and capture the right people',
        text: 'Save leads from any website with the Chrome extension, find work emails, build prospect lists from CSV or Excel, and turn website visitors into named enquiries, with consent checks built in.',
        points: ['Chrome & Edge lead capture', 'Email finder and verification', 'Consent-aware visitor intelligence'],
      },
      {
        key: 'engage', label: 'Engage', color: 'plasma', media: 'sequences',
        title: 'Start conversations that keep going',
        text: 'Multi-step email sequences with A/B tests and stop rules, a shared inbox threaded onto records, meetings with notes, plus WhatsApp and SMS from your own accounts.',
        points: ['Sequences with A/B variants', 'Inbox and meetings on the timeline', 'Drag-and-drop email designer'],
      },
      {
        key: 'automate', label: 'Automate', color: 'gold', media: 'automation',
        title: 'Let the busywork run itself',
        text: 'Build workflows visually, or describe one and let AI draft it. Simulate every workflow before it goes live, then watch each run with retries, approvals and a full history.',
        points: ['Visual Automation Studio', 'Simulation before activation', 'Approvals for sensitive steps'],
      },
      {
        key: 'predict', label: 'Predict', color: 'mint', media: 'forecasting',
        title: 'Know what will close, and why',
        text: 'Lead scores, deal health and forecasts that show their working: every number comes with the signals and records behind it, never a black box.',
        points: ['Explainable lead scores', 'Deal health with reasons', 'Month, quarter and year forecasts'],
      },
      {
        key: 'close', label: 'Close', color: 'ember', media: 'bids',
        title: 'Send the winning offer, fast',
        text: 'Quick Bid Studio with ten ready templates, a product catalogue, quotes, proposals with shareable signed links, contracts and e-signature, in English or Arabic, right to left.',
        points: ['Quick Bid Studio templates', 'Quotes, proposals and contracts', 'DocuSign and card payments'],
      },
      {
        key: 'grow', label: 'Grow', color: 'rose', media: 'success',
        title: 'Keep customers and grow accounts',
        text: 'Customer health with churn signals, renewals on the radar, a branded client portal, and team competitions that reward the work that actually moves revenue.',
        points: ['Churn signals and health scores', 'Client portal', 'Configurable gamification'],
      },
    ],
  },

  features: {
    eyebrow: 'The platform',
    title: 'Everything that powers *the force*',
    sub: 'Built as one product from day one, not stitched together from acquisitions.',
    tiles: [
      { key: 'command', size: 'xl', media: 'command', color: 'ember', title: 'Command Center', text: 'Live KPIs you can trust. Hover any number to see its formula; missing data shows a dash and the reason, never a fake zero. Rearrange it to fit how you sell.' },
      { key: 'copilot', size: 'tall', media: 'copilot', color: 'plasma', title: 'Copilot that asks first', text: 'Ask in plain language. Reading runs straight away; anything that changes data waits for your confirmation.' },
      { key: 'pipeline', size: 'wide', media: 'pipeline', color: 'volt', title: 'Pipelines your way', text: 'Kanban, table and forecast views, multiple pipelines, custom stages and a deal panel that opens without leaving the board.' },
      { key: 'galaxy', size: 'wide', media: 'galaxy', color: 'plasma', title: 'Relationship Galaxy', text: 'Your accounts, people and deals as a 3D network, with 2D and list views for every screen.' },
      { key: 'globe', size: 'md', media: 'globe', color: 'mint', title: 'Revenue Globe', text: 'See where revenue comes from, country by country, then drill into territories.' },
      { key: 'replay', size: 'md', media: 'replay', color: 'gold', title: 'Pipeline replay', text: 'Rewind the pipeline to any day and play it forward to see how deals actually moved.' },
      { key: 'health', size: 'md', media: 'health', color: 'volt', title: 'Deal health', text: 'Every open deal scored hourly, with the reasons written out, so managers know where to step in.' },
      { key: 'revenue', size: 'wide', media: 'revenue', color: 'ember', title: 'Revenue intelligence', text: 'Wins by month, funnel, owners, lead sources and loss reasons, plus a report builder with templates and saved dashboards.' },
      { key: 'apps', size: 'wide', media: 'apps', color: 'gold', title: 'Workspace apps', text: 'Slack, Teams, Zoom, DocuSign, WhatsApp, Twilio, Zapier, Stripe and Razorpay, connected with your own accounts.' },
    ],
  },

  agents: {
    eyebrow: 'Your digital sales team',
    title: 'Ten AI agents. *Every one on a leash.*',
    sub: 'Agents in SampForce are permissioned teammates, not black boxes. Each has a role, a list of tools it may use, a credit budget, an audit trail and an off switch.',
    list: [
      { name: 'Copilot', text: 'Answers questions about your pipeline and proposes changes for you to confirm.' },
      { name: 'Lead Qualification', text: 'Scores and qualifies new leads, and shows the signals behind the score.' },
      { name: 'Deal Intelligence', text: 'Spots risk in open deals and suggests the next best action.' },
      { name: 'Meeting Notes', text: 'Turns meetings and transcripts into notes, tasks and updates.' },
      { name: 'Proposal Draft', text: 'Drafts proposals from the deal, the catalogue and your templates.' },
      { name: 'Workflow Builder', text: 'Turns a sentence into an editable workflow you simulate first.' },
      { name: 'Forecast Explainer', text: 'Explains what moved the forecast and which deals matter most.' },
      { name: 'Email Assistant', text: 'Writes, rewrites and translates emails in your tone.' },
      { name: 'Voice Assistant', text: 'Turns a spoken note into a task, note, lead or contact, saved only when you confirm.' },
      { name: 'Retention Advisor', text: 'Reads customer health and drafts a plan to save at-risk accounts.' },
    ],
    guardrails: ['Tool allowlist per agent', 'Approval tiers for changes', 'Monthly credit caps', 'Full audit trail', 'Kill switch for admins', 'Usage and cost visible live'],
  },

  immersive: {
    eyebrow: 'Revenue you can see',
    title: 'Step *inside* your pipeline',
    sub: 'Spin the globe. Drag the galaxy. Replay last quarter. SampForce turns rows of numbers into views your whole team understands in seconds, and every 3D view has an accessible 2D or table version, plus a low-power mode.',
    stats: [
      { value: '3D', label: 'Relationship Galaxy' },
      { value: '2D', label: 'Accessible alternatives' },
      { value: '4', label: 'Motion levels, incl. off' },
    ],
  },

  difference: {
    eyebrow: 'Why SampForce',
    title: 'Different *where it counts*',
    sub: 'We studied fifteen CRM vendors’ public pricing pages. Here is what we chose to do differently. Flip each card.',
    cards: [
      {
        title: 'Predictable AI',
        market: 'AI is often sold as credits, sessions or a per-user add-on on top of the plan.',
        us: 'Every plan prints its AI credit allowance, from 50 to 3,000 credits per seat per month, and admins see usage and cost live.',
      },
      {
        title: 'No onboarding toll',
        market: 'Some vendors state required onboarding or implementation fees, or seat minimums.',
        us: 'No mandatory onboarding fee on self-service plans, and no seat minimum below Business.',
      },
      {
        title: 'Security for everyone',
        market: 'Single sign-on is frequently placed in the top tiers.',
        us: 'SSO (OpenID Connect) and SCIM provisioning on every plan, Free included, plus two-step verification.',
      },
      {
        title: 'One data model',
        market: 'Sales, marketing and service are commonly sold as separate hubs or products.',
        us: 'Sales, marketing journeys and customer success share one timeline per customer. No sync jobs between hubs.',
      },
      {
        title: 'AI that shows its working',
        market: 'Scores and recommendations can be hard to trace back to data.',
        us: 'Every score, forecast and suggestion lists the signals and records behind it, and changes wait for approval.',
      },
      {
        title: 'Global from day one',
        market: 'Right-to-left languages and accessibility can be an afterthought.',
        us: 'English, Spanish, French, German and Arabic with full right-to-left layout and Arabic PDFs; WCAG 2.2 AA checks run on every key page.',
      },
    ],
    priceChart: {
      title: 'Published entry prices, per user per month',
      note: 'Lowest published paid plan on annual billing, as shown on each vendor’s US pricing page on 30 Oct 2026. List prices change often; plans differ in what they include.',
      rows: [
        { name: 'SampForce Launch', price: 6, us: true },
        { name: 'Freshsales Growth', price: 9 },
        { name: 'Close Solo', price: 9 },
        { name: 'Nutshell', price: 13 },
        { name: 'Pipedrive Lite', price: 14 },
        { name: 'Copper Basic', price: 23 },
        { name: 'Salesforce Starter Suite', price: 25 },
        { name: 'Insightly Plus', price: 29 },
        { name: 'Dynamics 365 Sales Professional', price: 65 },
      ],
    },
  },

  tour: {
    eyebrow: 'Product tour',
    title: 'Inside *SampForce*',
    sub: 'Real screens from the product, filled with clearly labelled demo data. Drag to spin, click to open.',
    shots: [
      { media: 'command', title: 'Command Center', group: 'Sell' },
      { media: 'pipeline', title: 'Kanban pipeline', group: 'Sell' },
      { media: 'deal-panel', title: 'Deal side panel', group: 'Sell' },
      { media: 'leads', title: 'Leads', group: 'Sell' },
      { media: 'companies', title: 'Companies', group: 'Sell' },
      { media: 'copilot', title: 'Copilot', group: 'AI' },
      { media: 'agents', title: 'AI agents & controls', group: 'AI' },
      { media: 'health', title: 'Deal health', group: 'AI' },
      { media: 'forecasting', title: 'Forecasting', group: 'AI' },
      { media: 'automation', title: 'Automation Studio', group: 'Automate' },
      { media: 'sequences', title: 'Email sequences', group: 'Automate' },
      { media: 'apps', title: 'Workspace apps', group: 'Automate' },
      { media: 'bids', title: 'Bid templates', group: 'Close' },
      { media: 'bid-studio', title: 'Quick Bid Studio', group: 'Close' },
      { media: 'quotes', title: 'Quotes & proposals', group: 'Close' },
      { media: 'contracts', title: 'Contracts', group: 'Close' },
      { media: 'success', title: 'Customer success', group: 'Grow' },
      { media: 'revenue', title: 'Revenue intelligence', group: 'Grow' },
      { media: 'visitors', title: 'Website visitors', group: 'Grow' },
      { media: 'galaxy', title: 'Relationship Galaxy', group: 'Visualise' },
      { media: 'globe', title: 'Revenue Globe', group: 'Visualise' },
      { media: 'replay', title: 'Pipeline replay', group: 'Visualise' },
      { media: 'flow', title: 'Pipeline flow', group: 'Visualise' },
      { media: 'security', title: 'Workspace security', group: 'Admin' },
      { media: 'theme-studio', title: 'Theme Studio', group: 'Admin' },
    ],
  },

  anywhere: {
    eyebrow: 'Make it yours',
    title: 'Your brand. Your theme. *Any screen.*',
    sub: 'Twelve built-in themes plus a brand studio with a live readability check, light and dark modes, density and motion settings, and a phone layout with a bottom bar for selling on the move.',
    points: ['12 themes + custom brand colours', 'Light, dark or follow the system', 'Phone layout with quick create', 'Contrast checked as you design'],
  },

  numbers: [
    { value: 10, suffix: '', label: 'AI agents with guardrails' },
    { value: 5, suffix: '', label: 'Languages, incl. Arabic RTL' },
    { value: 10, suffix: '', label: 'Ready bid templates' },
    { value: 9, suffix: '+', label: 'Workspace apps to connect' },
    { value: 0, suffix: '', prefix: '$', label: 'Onboarding fee on self-service' },
  ],

  pricing: {
    eyebrow: 'Pricing',
    title: 'Simple plans. *Allowances in print.*',
    sub: 'USD per user per month, excluding taxes. AI credits are per seat per month and pooled across your workspace.',
    plans: [
      { name: 'Free', monthly: 0, annual: 0, target: 'Individuals, up to 2 users', ai: '50', runs: '500', pipelines: '1' },
      { name: 'Launch', monthly: 8, annual: 6, target: 'Startups', ai: '200', runs: '2,000', pipelines: '3' },
      { name: 'Growth', monthly: 15, annual: 12, target: 'Growing teams', ai: '500', runs: '10,000', pipelines: '10', featured: true },
      { name: 'Professional', monthly: 29, annual: 23, target: 'Advanced sales teams', ai: '1,000', runs: '50,000', pipelines: '25' },
      { name: 'Business', monthly: 49, annual: 39, target: 'Established businesses', ai: '2,000', runs: '150,000', pipelines: '50' },
      { name: 'Enterprise', monthly: 79, annual: 65, target: 'Large organisations', ai: '3,000', runs: '500,000', pipelines: 'Unlimited' },
    ],
    custom: { name: 'Enterprise Plus', text: 'Custom terms, volumes and support for global enterprises.' },
    footnote: 'Automation runs are per workspace per month. 1 AI credit = one standard Copilot or agent step; deep-reasoning steps use 4.',
  },

  trust: {
    eyebrow: 'Built to be trusted',
    title: 'Enterprise-grade, *on every plan*',
    items: [
      { title: 'Tenant isolation', text: 'A shared guard on every database query keeps every workspace’s data apart.' },
      { title: 'SSO + SCIM', text: 'OpenID Connect sign-in and SCIM 2.0 provisioning, on every plan.' },
      { title: 'Two-step verification', text: 'Authenticator codes, recovery codes, lockout and device sign-out.' },
      { title: 'Audit trail', text: 'Every change, by people or agents, is recorded and searchable.' },
      { title: 'Encrypted secrets', text: 'Tokens and keys are encrypted at rest, with a key-rotation runbook.' },
      { title: 'Accessible', text: 'WCAG 2.2 AA checks in light and dark themes on every key page.' },
    ],
  },

  cta: {
    title: 'Ready to feel the force?',
    sub: 'See SampForce with your own pipeline in a 30-minute live demo.',
    primary: 'Book a live demo',
    secondary: 'Talk to sales',
  },

  footer: {
    note: 'Screens show demo workspaces with synthetic data. Competitor information is taken from vendors’ public pages on 30 Oct 2026 and may have changed; plans are not like-for-like. All trademarks belong to their owners.',
  },
};
