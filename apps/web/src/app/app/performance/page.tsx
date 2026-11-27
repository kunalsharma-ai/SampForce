import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { PerformanceBoard } from '@/components/task-plans/performance';

export const metadata: Metadata = { title: 'Performance' };

export default function PerformancePage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Performance"
        description="Where managers and executives stand this week, month or quarter, by a score whose measures and weights the Super Workspace chooses. Every point can be traced back to the records."
      />
      <PerformanceBoard />
    </div>
  );
}
