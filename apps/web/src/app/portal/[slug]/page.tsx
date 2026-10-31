import type { Metadata } from 'next';
import { PortalApp } from './portal-app';

export const metadata: Metadata = { title: 'Client portal', robots: { index: false, follow: false } };

export default async function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PortalApp slug={slug} />;
}
