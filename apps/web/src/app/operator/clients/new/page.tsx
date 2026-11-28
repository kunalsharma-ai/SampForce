'use client';

import { CreateClientWizard } from '@/components/console/create-client-wizard';
import { ConsoleDenied, ConsoleLoading } from '@/components/console/console-states';
import { PageHeader } from '@/components/page-header';
import { can, useOperator } from '../../operator-shell';

/** Create client (control-center K2): the company, its details found and reviewed, the plan, then approve. */
export default function CreateClientPage() {
  const me = useOperator();
  if (!me.data) return <ConsoleLoading label="Loading" />;
  if (!can(me.data, 'clients.edit')) return <ConsoleDenied what="creating clients" />;
  return (
    <>
      <PageHeader
        title="Create client"
        description="Enter the company, check what SampForce found about it, choose the plan and administrator, then approve. Nothing is saved until you approve."
      />
      <CreateClientWizard />
    </>
  );
}
