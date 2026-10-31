import type { Metadata } from 'next';
import { PasswordPage } from '../password-forms';

export const metadata: Metadata = { title: 'Reset password', robots: { index: false, follow: false } };

export default async function ResetPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ token?: string }> }) {
  const { slug } = await params;
  const { token } = await searchParams;
  return <PasswordPage slug={slug} token={token ?? ''} mode="reset" />;
}
