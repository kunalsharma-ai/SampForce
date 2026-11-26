# ADR 0087: Personal profiles with photo and mood

Status: accepted (2026-11-26)

## Context

Kunal asked for every user to have a profile of their own: a photo, an attractive quote or bio, email, phone,
LinkedIn, and an emoji showing their current mood, made engaging enough that people enjoy filling it in. Profile
photos already existed (ADR 0072, M6) but were tucked into Account security and only shown in the account menu.

## Decision

- **One profile per person**, like the photo: a `UserProfile` document (collection `user_profiles`, keyed by the user)
  holds headline, quote, bio, LinkedIn URL, up to 8 "ask me about" tags, a cover (one of 8 named gradients) and the
  mood (emoji, up to 60 characters of text, set time, optional end time). Name and phone stay on the user. The sign-in
  email is shown but not editable here; changing it is an account flow.
- **Visibility** follows photos: people with an active membership in the reader's workspace. Anyone else gets 404.
- **Mood** is one emoji (checked by grapheme, so skin tones, flags and joined emoji count as one) plus optional text.
  It clears itself at `moodExpiresAt` (at most 30 days ahead); expired moods are filtered on read, so no job is
  needed. The web app works out "today" and "this week" in the person's own time zone.
- **Routes**: `GET/PUT /me/profile`, `PUT/DELETE /me/mood`, `GET /people/cards` (photo, headline and mood of everyone
  in the workspace, cached by the web app and shared by every avatar) and `GET /people/:id/profile`. All are open to
  the phone app too.
- **Web**: My profile at `/app/profile` (cover picker, photo editor with drag, zoom and turn, cropped to a 512 px JPEG
  in the browser, mood picker, completeness ring, live "how teammates see you" card). One `UserAvatar` component
  shows the photo or coloured initials and the mood emoji; it replaces the hand-drawn initials in the header, team
  chat, Team Management and deal owner chips. A profile card (popover) opens from Team Management and chat avatars.
- Lists elsewhere (owner refs, member rows) were not changed: avatars look people up by user id in the cached cards,
  so no list endpoint loads profile data.

## Consequences

- Workspaces with many hundreds of people load one larger cards list; acceptable, it is cached for a minute.
- Closing a company erases the profiles of people who belonged only to it, with their photos.
