import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { TemplateGallery } from './template-gallery';

export const metadata: Metadata = { title: 'Bid templates' };

export default function BidTemplatesPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Bid templates"
        description="Ten looks for proposals, each with starting sections you can rewrite. Pick one, set your accent colour and start a bid with it. Previews use example content."
      />
      <RequirePermission permission="quotes:read">
        <TemplateGallery />
      </RequirePermission>
    </div>
  );
}
