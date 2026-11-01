import { Input } from '@dealflow/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Combobox, MultiCombobox } from '@/components/forms/combobox';
import { FloatingField } from '@/components/forms/floating-field';
import { CountrySelect, CurrencyInput, CurrencySelect, NumberStepper, PhoneInput, TimeZoneSelect } from '@/components/forms/inputs';
import { RangeField, Segmented } from '@/components/forms/segmented';
import { UploadZone } from '@/components/forms/upload-zone';

/** The form library (components/forms): searchable pickers, phone, money, steppers, chips and uploads. */
const meta: Meta = { title: 'Design system/Forms' };
export default meta;
type Story = StoryObj;

function Labelled({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="max-w-sm space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

const STAGES = [
  { value: 'new', label: 'New', hint: '10%' },
  { value: 'qualified', label: 'Qualified', hint: '25%' },
  { value: 'proposal', label: 'Proposal sent', hint: '60%' },
  { value: 'won', label: 'Closed won', hint: '100%' },
];

export const SearchablePicker: Story = {
  render: function Render() {
    const [v, setV] = useState('qualified');
    return (
      <Labelled id="sb-stage" label="Stage">
        <Combobox id="sb-stage" options={STAGES} value={v} onChange={setV} placeholder="Search stages" />
      </Labelled>
    );
  },
};

export const TagChips: Story = {
  render: function Render() {
    const [v, setV] = useState(['enterprise', 'renewal']);
    return (
      <Labelled id="sb-tags" label="Tags">
        <MultiCombobox id="sb-tags" value={v} onChange={setV} creatable itemLabel="tag" options={[{ value: 'priority', label: 'priority' }]} />
      </Labelled>
    );
  },
};

export const CountryCurrencyTimeZone: Story = {
  render: function Render() {
    const [country, setCountry] = useState('GB');
    const [currency, setCurrency] = useState('GBP');
    const [zone, setZone] = useState('Europe/London');
    return (
      <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
        <Labelled id="sb-country" label="Country">
          <CountrySelect id="sb-country" value={country} onChange={setCountry} />
        </Labelled>
        <Labelled id="sb-currency" label="Currency">
          <CurrencySelect id="sb-currency" value={currency} onChange={setCurrency} />
        </Labelled>
        <Labelled id="sb-zone" label="Time zone">
          <TimeZoneSelect id="sb-zone" value={zone} onChange={setZone} />
        </Labelled>
      </div>
    );
  },
};

export const PhoneAndMoney: Story = {
  render: function Render() {
    const [phone, setPhone] = useState('+442079460958');
    const [amount, setAmount] = useState('24000');
    return (
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Labelled id="sb-phone" label="Phone">
          <PhoneInput id="sb-phone" value={phone} onChange={setPhone} />
        </Labelled>
        <Labelled id="sb-amount" label="Deal value">
          <CurrencyInput id="sb-amount" value={amount} onChange={setAmount} currency="EUR" />
        </Labelled>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Stored as <code dir="ltr">{phone || '—'}</code> and <code dir="ltr">{amount || '—'}</code>; grouping follows the language and region setting.
        </p>
      </div>
    );
  },
};

export const Stepper: Story = {
  render: function Render() {
    const [v, setV] = useState('25');
    return (
      <Labelled id="sb-prob" label="Probability">
        <NumberStepper id="sb-prob" label="probability" value={v} onChange={setV} min={0} max={100} step={5} suffix="%" />
      </Labelled>
    );
  },
};

export const SegmentedAndRange: Story = {
  render: function Render() {
    const [density, setDensity] = useState<'comfortable' | 'balanced' | 'compact'>('balanced');
    const [radius, setRadius] = useState(10);
    return (
      <div className="max-w-md space-y-5">
        <Segmented
          legend="Density"
          name="sb-density"
          value={density}
          onChange={setDensity}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
        <RangeField id="sb-radius" label="Corner radius" value={radius} min={0} max={20} unit="px" onChange={setRadius} />
      </div>
    );
  },
};

export const FloatingLabel: Story = {
  render: () => (
    <div className="max-w-sm space-y-4">
      <FloatingField id="sb-email" label="Work email">
        <Input type="email" autoComplete="email" />
      </FloatingField>
      <FloatingField id="sb-pass" label="Password" error="Use at least 10 characters.">
        <Input type="password" defaultValue="short" />
      </FloatingField>
    </div>
  ),
};

export const Upload: Story = {
  render: function Render() {
    const [file, setFile] = useState<{ name: string; size: number } | null>(null);
    return (
      <div className="max-w-md">
        <UploadZone label="Upload a logo" accept={['.png', '.svg', 'image/png', 'image/svg+xml']} maxBytes={512 * 1024} file={file} onFile={(f) => setFile({ name: f.name, size: f.size })} onClear={() => setFile(null)} hint="PNG or SVG, up to 512 KB." />
      </div>
    );
  },
};
