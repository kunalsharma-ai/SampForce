import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '../cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

/** 'right' and 'left' are the end and start edges, so in right-to-left languages the panels swap sides. */
type Side = 'right' | 'left' | 'center';

const sideClasses: Record<Side, string> = {
  right: 'inset-y-0 end-0 h-full w-full max-w-md border-s data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left',
  left: 'inset-y-0 start-0 h-full w-72 border-e data-[state=open]:slide-in-from-left rtl:data-[state=open]:slide-in-from-right',
  center: 'left-1/2 top-[15%] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border data-[state=open]:zoom-in-95',
};

/** Dialog surface. `side` turns it into a slide-over sheet (mobile nav, Copilot panel). */
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: Side; hideClose?: boolean }
>(({ className, children, side = 'center', hideClose, onEscapeKeyDown, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 df-glass border-border bg-popover text-popover-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0',
        sideClasses[side],
        className,
      )}
      {...props}
      onEscapeKeyDown={(e) => {
        // Escape in an open picker closes the picker's list, not the dialog around it. The dialog hears Escape first
        // (it listens in the capture phase), so it has to step aside here.
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest('[role="combobox"][aria-expanded="true"]')) e.preventDefault();
        onEscapeKeyDown?.(e);
      }}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close className="absolute end-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" aria-hidden />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';
