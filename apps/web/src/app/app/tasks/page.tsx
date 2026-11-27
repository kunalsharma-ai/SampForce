import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { TasksTabs } from '@/components/task-plans/tasks-tabs';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Tasks"
        description="Today’s tasks, the recurring tasks that make them, and one-off tasks handed down from the workspace above yours. Progress counts by itself from the records you add."
      />
      <Suspense>
        <TasksTabs />
      </Suspense>
    </div>
  );
}
