import { redirect } from 'next/navigation';

/** Custom fields moved into Settings → CRM configuration (ADR 0062); old links still work. */
export default function CustomFieldsPage() {
  redirect('/app/settings/crm?section=fields');
}
