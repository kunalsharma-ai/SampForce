import { BID_TEMPLATES } from '@dealflow/types';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { AccentPicker } from '@/components/bids/accent-picker';
import { EXAMPLE_LINES, previewProposal, ProposalPreview, TemplateThumb } from '@/components/bids/bid-preview';

/** Quick Bid Studio building blocks. The proposal is example data; it uses the same document as the customer's link. */
const meta: Meta = { title: 'Product/Bids' };
export default meta;
type Story = StoryObj;

export const TemplateGallery: Story = {
  render: () => (
    <ul className="grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-5">
      {BID_TEMPLATES.map((t) => (
        <li key={t.key} className="space-y-1.5">
          <TemplateThumb template={t} />
          <p className="text-xs font-medium">{t.name}</p>
        </li>
      ))}
    </ul>
  ),
};

export const ProposalWithAccent: Story = {
  render: function Render() {
    const template = BID_TEMPLATES[0]!;
    const [accent, setAccent] = useState<string | null>(null);
    const proposal = previewProposal({
      seller: { name: 'Northwind Traders' },
      templateKey: template.key,
      accentColor: accent,
      title: 'Platform rollout for Contoso (example)',
      preparedFor: 'Contoso Ltd',
      currency: 'EUR',
      validUntil: '2026-12-01',
      sections: [{ heading: 'Scope', body: 'Discovery, licences for 25 people and two onboarding sessions.' }],
      lines: EXAMPLE_LINES,
      terms: 'Payment within 30 days of invoice.',
    });
    return (
      <div className="grid max-w-5xl gap-6 lg:grid-cols-[18rem_1fr]">
        <AccentPicker value={accent} templateAccent={template.style.accent} onChange={setAccent} />
        <ProposalPreview proposal={proposal} />
      </div>
    );
  },
};
