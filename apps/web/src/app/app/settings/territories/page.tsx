import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { TerritoriesManager } from './territories-manager';

export const metadata: Metadata = { title: 'Territories' };

export default function TerritoriesPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Territories" description="Group countries into sales territories. Deals follow their company’s country, and the Territory view on Deals shows pipeline for each." />
      <TerritoriesManager />
    </div>
  );
}
