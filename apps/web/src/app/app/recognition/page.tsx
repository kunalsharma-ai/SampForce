import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { RecognitionTabs } from '@/components/recognition/recognition-tabs';

export const metadata: Metadata = { title: 'Recognition' };

export default function RecognitionPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Recognition"
        description="Employee of the Month targets and winners, and performance improvement plans, counted from the records."
      />
      <Suspense>
        <RecognitionTabs />
      </Suspense>
    </div>
  );
}
