import type { Metadata } from 'next';
import { LeadDetail } from './lead-detail';

export const metadata: Metadata = { title: 'Lead' };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  return <LeadDetail id={(await params).id} />;
}
