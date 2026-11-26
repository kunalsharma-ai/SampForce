import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MyProfilePage } from './my-profile';

export const metadata: Metadata = { title: 'My profile' };

export default function ProfilePage() {
  return (
    <Suspense>
      <MyProfilePage />
    </Suspense>
  );
}
