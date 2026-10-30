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
        description="A weighted-probability projection of this quarter's open and won deals. These are projections from your pipeline data, not commitments."
      />
      <RequirePermission permission="deals:read">
        <RequirePermission permission="dashboard:read">
          <ForecastWorkspace />
        </RequirePermission>
      </RequirePermission>
    </div>
  );
}
