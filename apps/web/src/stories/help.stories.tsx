import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { InfoTip } from '@/components/info-tip';

/**
 * The "i" help button. It sits beside a page title, section heading or setting, never inside the heading, and opens a
 * short explanation in the reader's language: what the feature is for, how to use it, and where to use it. Text
 * comes from lib/help; pick the language in the toolbar to see each translation.
 */
const meta: Meta<typeof InfoTip> = {
  title: 'Design system/Info tip',
  component: InfoTip,
  args: { topic: 'page.deals' },
};
export default meta;
type Story = StoryObj<typeof InfoTip>;

export const BesideASectionHeading: Story = {
  render: (args) => (
    <Card className="max-w-md">
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>Usage this month</CardTitle>
          <InfoTip {...args} topic="billing.usage" />
        </div>
        <CardDescription>Seats, records and AI credits used so far.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">…</CardContent>
    </Card>
  ),
};

export const Open: Story = {
  args: { topic: 'page.deals', defaultOpen: true },
  render: (args) => (
    <div className="min-h-[22rem]">
      <div className="flex items-center gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Deals</h1>
        <InfoTip {...args} />
      </div>
    </div>
  ),
};
