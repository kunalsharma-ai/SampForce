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

- **The photo everywhere** (Kunal, 2026-11-27): the welcome banner on every home dashboard shows the photo in its
  avatar ring (initials when there is none or it fails to load). Console operators are separate accounts, so they
  get an `OperatorPhoto` of their own (`PUT/DELETE /operator/me/photo`, served at `GET /operator/photos/:id` to
  signed-in operators only); without one, the Console uses the photo of the SampForce account with the same email,
  so a photo chosen on My profile shows in the Console too, without a second upload. It shows on the Console top
  bar, the Overview greeting, the operators list and the Console account page, where it can be replaced or removed.
  The phone app already used the profile photo.

- **Birthdays** (Kunal, 2026-11-27): My profile takes a date of birth (day and month; the year is optional). Teammates
  see only the day and month unless the person shares the year (`birthYearVisible`, off by default), and nothing at
  all when they keep it private (`celebrateBirthday` off). `GET /people/birthdays?date=` lists today's birthdays in
  the workspace for the reader's own local date (time zones differ, so the browser or phone sends it); 29 February
  is celebrated on 28 February in other years. Every dashboard tab shows a celebration (photos, confetti, "Wish"
  buttons that send a team chat message; your own birthday says Happy birthday), as do the phone app's home screen
  and the Console Overview (`GET /operator/birthdays`, operators matched to their SampForce account by email). It is
  a separate card under the welcome banner rather than part of the banner's special-day ribbon.

## Consequences

- Workspaces with many hundreds of people load one larger cards list; acceptable, it is cached for a minute.
- Closing a company erases the profiles of people who belonged only to it, with their photos.
