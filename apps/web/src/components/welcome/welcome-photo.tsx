'use client';

import { useState } from 'react';

/**
 * What fills the welcome banner's round avatar (ADR 0087): the person's profile photo inside the turning ring, or their
 * initials on the workspace's colours when they have none or it fails to load.
 */
export function WelcomePhoto({ initials, photoUrl }: { initials: string; photoUrl: string | null }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!photoUrl || broken === photoUrl) return <span data-welcome-avatar="initials">{initials}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image that Next cannot optimise
    <img data-welcome-avatar="photo" src={photoUrl} alt="" className="sf-welcome-photo" onError={() => setBroken(photoUrl)} />
  );
}
