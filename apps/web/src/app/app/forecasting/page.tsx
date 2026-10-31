import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { ForecastWorkspace } from './forecast-workspace';

export const metadata: Metadata = { title: 'Forecasting' };

export default function ForecastingPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Forecasting"
        description="Monthly, quarterly and yearly projections from your open and won deals, compared with targets. These are projections from your pipeline data, not commitments."
      />
      <RequirePermission permission="deals:read">
        <RequirePermission permission="dashboard:read">
          <ForecastWorkspace />
        </RequirePermission>
      </RequirePermission>
    </div>
  );
}
