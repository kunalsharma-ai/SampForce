import type { Metadata } from 'next';
import { PublicForm } from './public-form';

export const metadata: Metadata = { title: 'Form', robots: { index: false, follow: false } };

export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-start justify-center bg-background px-4 py-10">
      <PublicForm token={token} />
    </main>
  );
}
