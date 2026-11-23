import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MyQueries } from '@/components/help/my-queries';

export const metadata: Metadata = { title: 'My queries' };

export default function QueriesPage() {
  return (
    <Suspense>
      <MyQueries />
    </Suspense>
  );
}
