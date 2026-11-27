'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PhotoEditor } from '@/components/people/photo-editor';
import { UserAvatar } from '@/components/people/user-avatar';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/**
 * The person's profile photo (ADR 0072, M6): shown next to their name across SampForce and in the phone app, to
 * people in the same organisation. The rest of the profile (bio, mood, contact details) is on My profile (ADR 0087).
 */
export function ProfilePhotoCard() {
  const t = useT();
  const me = useSession();
  const [open, setOpen] = useState(false);
  const photoUrl = me.data?.user.photoUrl ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Profile photo')}</CardTitle>
        <CardDescription>{t('People in your organisation see it in the account menu, in team chat and in the SampForce app.')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <span role="img" aria-label={photoUrl ? t('Your photo') : t('No photo yet')}>
          <UserAvatar userId={me.data?.user.id} name={me.data?.user.name} photoUrl={photoUrl} showMood={false} className="size-20 text-xl" tone="from-primary to-accent" />
        </span>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setOpen(true)}>
            {photoUrl ? t('Change photo') : t('Add a photo')}
          </Button>
          <Button asChild variant="outline">
            <Link href="/app/profile">{t('Edit my profile')}</Link>
          </Button>
        </div>
        <PhotoEditor open={open} onOpenChange={setOpen} hasPhoto={!!photoUrl} />
      </CardContent>
    </Card>
  );
}
