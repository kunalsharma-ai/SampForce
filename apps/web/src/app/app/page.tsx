import type { Metadata } from 'next';
import { CommandCenter } from './command-center-tabs';

export const metadata: Metadata = { title: 'Command Center' };

export default function Page() {
  return <CommandCenter />;
}
