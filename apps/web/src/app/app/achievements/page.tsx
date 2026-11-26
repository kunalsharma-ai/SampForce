import type { Metadata } from 'next';
import { MyAchievements } from '@/components/achievements/my-achievements';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'My achievements' };

export default function AchievementsPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="My achievements" description="Your real achievements and milestones, your progress today, and how SampForce celebrates them." />
      <MyAchievements />
    </div>
  );
}
