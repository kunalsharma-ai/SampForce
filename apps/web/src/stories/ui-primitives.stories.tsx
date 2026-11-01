import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@dealflow/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';

/** The primitives in packages/ui. Every app screen is built from these. */
const meta: Meta<typeof Button> = {
  title: 'Design system/Primitives',
  component: Button,
  args: { children: 'Save changes' },
  argTypes: {
    variant: { control: 'select', options: ['default', 'accent', 'outline', 'ghost', 'destructive', 'link'] },
    size: { control: 'select', options: ['default', 'sm', 'lg', 'icon'] },
  },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const ButtonPlayground: Story = {};

export const ButtonVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Primary</Button>
      <Button variant="accent">Accent</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">
        <Trash2 aria-hidden /> Delete
      </Button>
      <Button variant="link">Link</Button>
      <Button size="sm">
        <Plus aria-hidden /> Small
      </Button>
      <Button size="lg">
        Continue <ArrowRight className="rtl:-scale-x-100" aria-hidden />
      </Button>
      <Button size="icon" aria-label="Add">
        <Plus aria-hidden />
      </Button>
      <Button disabled>Disabled</Button>
    </div>
  ),
};

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(['neutral', 'primary', 'accent', 'success', 'warning', 'critical'] as const).map((tone) => (
        <Badge key={tone} tone={tone}>
          {tone}
        </Badge>
      ))}
    </div>
  ),
};

export const CardWithField: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>Fields use Field, which wires the label, hint and error to the input.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field id="sb-name" label="Workspace name" hint="Shown to everyone you invite.">
          <Input defaultValue="Northwind Traders" />
        </Field>
        <Field id="sb-domain" label="Website" error="Use a full address such as https://example.com.">
          <Input defaultValue="northwind" />
        </Field>
      </CardContent>
    </Card>
  ),
};

export const Loading: Story = {
  render: () => (
    <div role="status" className="max-w-md space-y-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  ),
};

export const Menu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open menu</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Quick create</DropdownMenuLabel>
        <DropdownMenuItem>
          <Plus aria-hidden /> Lead
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Plus aria-hidden /> Deal
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Plus aria-hidden /> Contract (no permission)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const TooltipOnIcon: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Add a task">
          <Plus aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Add a task</TooltipContent>
    </Tooltip>
  ),
};

export const SidePanel: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open side panel</Button>
      </DialogTrigger>
      <DialogContent side="right" className="p-6">
        <DialogTitle className="text-lg font-semibold">Deal details</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">Panels open from the end edge, which is the left in right-to-left languages.</DialogDescription>
      </DialogContent>
    </Dialog>
  ),
};
