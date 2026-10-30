import type { Metadata } from 'next';
import { ContactDetail } from './contact-detail';

export const metadata: Metadata = { title: 'Contact' };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  return <ContactDetail id={(await params).id} />;
}
