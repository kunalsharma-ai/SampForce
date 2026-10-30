import type { Metadata } from 'next';
import { CompanyDetail } from './company-detail';

export const metadata: Metadata = { title: 'Company' };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  return <CompanyDetail id={(await params).id} />;
}
