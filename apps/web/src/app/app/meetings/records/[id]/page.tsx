import type { Metadata } from 'next';
import { MeetingRecordView } from './meeting-record';

export const metadata: Metadata = { title: 'Meeting notes' };

export default async function MeetingRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingRecordView id={id} />;
}
