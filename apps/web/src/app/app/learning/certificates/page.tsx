import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CertificatesPage } from '@/components/learning/certificates';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Certificates' };

export default function LearningCertificatesPage() {
  return (
    <div className="max-w-7xl">
      <PageHeader title="Certificates" description="Certificates earned by passing learning modules, with a verification code anyone can check." />
      <Suspense>
        <CertificatesPage />
      </Suspense>
    </div>
  );
}
