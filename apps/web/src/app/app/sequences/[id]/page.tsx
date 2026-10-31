import type { Metadata } from 'next';
import { RequirePermission } from '@/components/require-permission';
import { SequenceEditor } from './sequence-editor';

export const metadata: Metadata = { title: 'Sequence' };

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-6xl">
      <RequirePermission permission="sequences:read">
        <SequenceEditor id={id} />
      </RequirePermission>
    </div>
  );
}
