import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { TasksBoard } from '@/components/workspace-work/tasks';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Tasks" description="Tasks handed down from the workspace above yours, and the ones you assigned to your team. Open a task to comment, mark it done or see its history." />
      <Suspense>
        <TasksBoard />
      </Suspense>
    </div>
  );
}
