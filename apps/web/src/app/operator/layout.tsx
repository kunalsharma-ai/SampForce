import type { Metadata } from 'next';
import { OperatorShell } from './operator-shell';

export const metadata: Metadata = { title: { default: 'Operator console', template: '%s · SampForce operator console' }, robots: { index: false, follow: false } };

/** Platform staff only. A separate sign-in from workspaces; see docs/adr/0010-billing-and-operator-realm.md. */
export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return <OperatorShell>{children}</OperatorShell>;
}
