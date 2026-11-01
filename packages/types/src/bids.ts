import { z } from 'zod';
import { contrastRatio } from './appearance';
import type { ProposalSection } from './commercial';

/**
 * Design spec Part 6: bid templates. A template is a look (accent colour, typeface, cover style) plus starting
 * sections for a kind of bid. People edit every word; the look applies to the online proposal and its PDF.
 */
export const BID_FONTS = ['sans', 'serif'] as const;
export const BID_COVERS = ['band', 'minimal', 'dark', 'split'] as const;
export interface BidTemplate {
  key: string;
  name: string;
  category: string;
  description: string;
  style: { accent: string; font: (typeof BID_FONTS)[number]; cover: (typeof BID_COVERS)[number] };
  sections: ProposalSection[];
}

const S = (heading: string, body: string): ProposalSection => ({ heading, body });

export const BID_TEMPLATES: readonly BidTemplate[] = [
  {
    key: 'corporate-executive',
    name: 'Corporate Executive',
    category: 'General',
    description: 'Navy band and serif headings for board-level readers.',
    style: { accent: '#1e3a8a', font: 'serif', cover: 'band' },
    sections: [
      S('Executive summary', 'The decision you are asking for, the value it creates and the investment, in three sentences.'),
      S('Objectives', 'The outcomes the customer has asked for, in their words.'),
      S('Recommended approach', 'What you will deliver and why it is the right fit.'),
      S('Investment', 'The pricing below, with what is included.'),
      S('Next steps', 'What happens after acceptance and the proposed start date.'),
    ],
  },
  {
    key: 'minimal-premium',
    name: 'Minimal Premium',
    category: 'General',
    description: 'Quiet, generous spacing with a single charcoal accent.',
    style: { accent: '#27272a', font: 'sans', cover: 'minimal' },
    sections: [S('Summary', 'One paragraph on what this bid covers.'), S('Scope', 'What is included, as a short list.'), S('Terms', 'Validity, payment and any conditions.')],
  },
  {
    key: 'modern-blue',
    name: 'Modern Blue',
    category: 'General',
    description: 'Bright blue split cover for product and SaaS teams.',
    style: { accent: '#2563eb', font: 'sans', cover: 'split' },
    sections: [
      S('Why now', 'The problem the customer is facing today.'),
      S('Our proposal', 'The products and plans that solve it.'),
      S('Rollout', 'Onboarding steps and timeline.'),
      S('Support', 'Service levels and who to contact.'),
    ],
  },
  {
    key: 'dark-luxury',
    name: 'Dark Luxury',
    category: 'General',
    description: 'Black cover with gold accents for premium offers.',
    style: { accent: '#b08d57', font: 'serif', cover: 'dark' },
    sections: [S('Introduction', 'A short, personal opening.'), S('The offer', 'What is included and what makes it exceptional.'), S('Your investment', 'The pricing below.'), S('Acceptance', 'How to accept and what happens next.')],
  },
  {
    key: 'global-enterprise',
    name: 'Global Enterprise',
    category: 'Enterprise',
    description: 'Teal band for multi-country, multi-currency bids.',
    style: { accent: '#0f766e', font: 'sans', cover: 'band' },
    sections: [
      S('Executive summary', 'The programme, the countries covered and the expected result.'),
      S('Country coverage', 'Markets in scope, with local delivery notes for each.'),
      S('Governance', 'Account team, reporting cadence and escalation.'),
      S('Commercials', 'Pricing by region is listed below; currency and tax follow each market.'),
      S('Compliance', 'Data protection, local regulations and certifications.'),
    ],
  },
  {
    key: 'technology-proposal',
    name: 'Technology Proposal',
    category: 'Technology',
    description: 'Indigo split cover for software and integration projects.',
    style: { accent: '#4f46e5', font: 'sans', cover: 'split' },
    sections: [
      S('Current state', 'Systems in place today and the gaps.'),
      S('Solution architecture', 'Components, integrations and data flow.'),
      S('Implementation plan', 'Phases, milestones and acceptance criteria.'),
      S('Security', 'Hosting, access control and data protection.'),
      S('Support and SLAs', 'Response times and maintenance windows.'),
    ],
  },
  {
    key: 'market-research-bid',
    name: 'Market Research Bid',
    category: 'Research',
    description: 'Violet band with the sections research buyers expect.',
    style: { accent: '#7c3aed', font: 'sans', cover: 'band' },
    sections: [
      S('Research objectives', 'The business questions this study will answer.'),
      S('Methodology', 'Approach (quantitative, qualitative or mixed), mode and questionnaire length.'),
      S('Sample design', 'Target audience, markets, sample size per market, quotas and feasibility.'),
      S('Timeline', 'Fieldwork start, soft launch, full launch and data delivery dates.'),
      S('Deliverables', 'Data files, tables, dashboards or report, and their formats.'),
      S('Quality assurance', 'Respondent verification, attention checks and data cleaning.'),
    ],
  },
  {
    key: 'consulting-proposal',
    name: 'Consulting Proposal',
    category: 'Services',
    description: 'Forest green, serif type, structured for engagements.',
    style: { accent: '#166534', font: 'serif', cover: 'minimal' },
    sections: [
      S('Situation', 'What the client told you and what you observed.'),
      S('Objectives', 'What success looks like at the end of the engagement.'),
      S('Approach', 'Workstreams and how you will run them.'),
      S('Team', 'Who will do the work and their experience.'),
      S('Fees', 'Fees are listed below; expenses are billed at cost.'),
    ],
  },
  {
    key: 'healthcare-research',
    name: 'Healthcare Research Proposal',
    category: 'Research',
    description: 'Calm teal for HCP and patient studies with compliance sections.',
    style: { accent: '#0e7490', font: 'sans', cover: 'split' },
    sections: [
      S('Study objectives', 'Clinical or commercial questions the study addresses.'),
      S('Target respondents', 'HCP specialties, patient groups and inclusion criteria.'),
      S('Methodology', 'Interview mode, length, honoraria approach and recruitment sources.'),
      S('Compliance', 'Adverse event reporting, consent, and the codes of conduct followed.'),
      S('Timeline and deliverables', 'Fieldwork dates and outputs.'),
    ],
  },
  {
    key: 'financial-services',
    name: 'Financial Services Proposal',
    category: 'Financial',
    description: 'Deep slate with restrained serif type for regulated buyers.',
    style: { accent: '#334155', font: 'serif', cover: 'band' },
    sections: [
      S('Executive summary', 'The opportunity and the proposed engagement.'),
      S('Scope', 'Products, services and jurisdictions in scope.'),
      S('Risk and controls', 'How risks are identified, controlled and reported.'),
      S('Regulatory considerations', 'Relevant regulation and how the proposal meets it.'),
      S('Commercial terms', 'Pricing below, payment terms and validity.'),
    ],
  },
];
export const BID_TEMPLATE_KEYS = BID_TEMPLATES.map((t) => t.key) as [string, ...string[]];

export const bidTemplateKeySchema = z.enum(BID_TEMPLATE_KEYS);
export const bidAccentSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #2563eb');

export function bidTemplate(key: string | null | undefined): BidTemplate | null {
  return BID_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** The look a proposal renders with: its template (or the plain default) and the accent override, if any. */
export function bidStyle(key: string | null | undefined, accent: string | null | undefined, brandColor?: string | null) {
  const t = bidTemplate(key);
  return {
    templateKey: t?.key ?? null,
    accent: accent ?? t?.style.accent ?? brandColor ?? '#2563eb',
    font: t?.style.font ?? 'sans',
    cover: t?.style.cover ?? 'minimal',
  } as const;
}
export type BidStyle = ReturnType<typeof bidStyle>;

/** White or near-black, whichever reads better on the given accent. */
export function textOn(accent: string): '#ffffff' | '#111111' {
  return contrastRatio(accent, '#ffffff') >= contrastRatio(accent, '#111111') ? '#ffffff' : '#111111';
}
