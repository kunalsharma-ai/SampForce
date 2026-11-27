import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { WebsiteEnquiryWorkspace } from '@/components/website-enquiries/website-enquiries';

export const metadata: Metadata = { title: 'Website Enquiry' };

export default function WebsiteEnquiryPage() {
  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Website Enquiry"
        description="Every enquiry, download, live chat, newsletter sign-up and review from the company website, the moment it arrives. Follow each one up and turn it into a company and employee."
      />
      <RequirePermission permission="enquiries:read">
        <Suspense>
          <WebsiteEnquiryWorkspace />
        </Suspense>
      </RequirePermission>
    </div>
  );
}
