import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../cn';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'border-border bg-muted text-muted-foreground',
      primary: 'border-primary/30 bg-primary/10 text-primary',
      accent: 'border-accent/30 bg-accent/10 text-accent',
      success: 'border-success/30 bg-success/10 text-success',
      warning: 'border-warning/30 bg-warning/10 text-warning',
      critical: 'border-critical/30 bg-critical/10 text-critical',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
