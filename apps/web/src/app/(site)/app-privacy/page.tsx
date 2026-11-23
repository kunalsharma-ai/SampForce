import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mobile app privacy',
  description: 'What the SampForce app for iPhone and Android uses on your phone, where it sends it, what it keeps and how to remove it.',
};

/**
 * Privacy notice for the SampForce app for iPhone and Android (ADR 0072), linked from its App Store and Google Play
 * listings and from Profile in the app. It describes what the code in apps/mobile does; keep the two in step.
 */
export default function AppPrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-5">
      <h1 className="text-4xl font-semibold tracking-tight">SampForce mobile app: privacy</h1>
      <p className="text-muted-foreground">Last updated 23 November 2026</p>
      <p>
        The SampForce app for iPhone and Android lets people whose organisation uses SampForce work with their leads, contacts, follow-ups, tasks,
        targets and team chat on their phone. It works only after the organisation has switched the app on, and only with an account the organisation
        created. You cannot create an account in the app. Sampledge makes SampForce and the app. Your organisation decides what the app shows to each
        person and controls the data in its SampForce workspace.
      </p>

      <h2>What it uses on your phone</h2>
      <ul>
        <li>Your SampForce email and password when you sign in. They are sent to your organisation&apos;s SampForce server only, and the password is not stored.</li>
        <li>The phone&apos;s type, model, system version and app version, and a random number the app creates when it is installed. Your organisation&apos;s administrators see these in the list of phones signed in, so they can sign out a lost phone.</li>
        <li>The camera and your photo library, only when you choose to take or pick a profile picture. The app sends the one picture you choose, cropped and made smaller, and reads nothing else.</li>
        <li>A push notification address from Apple or Google, only if you turn notifications on.</li>
        <li>The phone&apos;s language, so the app and the server&apos;s messages use it.</li>
        <li>It does not use your location, contacts, microphone, calendar or other apps&apos; data. When you tap call, message, WhatsApp, email or directions on a record, the phone opens that app with the record&apos;s details; the app does not see what happens there.</li>
      </ul>

      <h2>Where it sends it</h2>
      <ul>
        <li>To your organisation&apos;s SampForce server: everything you view, add, change or write in the app goes there, as it does on the web, under the same permissions.</li>
        <li>Notifications go from your SampForce server through Expo&apos;s push service to Apple or Google, which deliver them to your phone. Each one carries a short title and text (for example a task name or the start of a chat message) and which screen to open. Your organisation chooses which notifications each level gets.</li>
        <li>No advertising, analytics or tracking code is in the app, and nothing is sent to anyone else. Sampledge does not sell or share the data.</li>
      </ul>

      <h2>What it keeps on your phone</h2>
      <ul>
        <li>The sign-in tokens, in the phone&apos;s secure storage (Keychain on iPhone, Keystore on Android), for this phone only. Never your password.</li>
        <li>Your server address, the organisation&apos;s published app settings and your language, so the app starts quickly.</li>
        <li>Profile pictures it has shown, while the app is open.</li>
      </ul>

      <h2>Removing it</h2>
      <ul>
        <li>Sign out in Profile. The phone&apos;s session ends on the server at once and the tokens are deleted from the phone.</li>
        <li>Turn notifications off in Profile, or in the phone&apos;s settings, and the server forgets the phone&apos;s notification address.</li>
        <li>Your organisation&apos;s administrators can sign out any phone, or switch the app off, which signs every phone out.</li>
        <li>Uninstalling the app removes what it kept on the phone.</li>
        <li>Your account and the records you worked on belong to your organisation&apos;s SampForce workspace. To have your account removed, ask your organisation&apos;s administrator; they can remove you from the workspace and ask Sampledge to delete your account.</li>
      </ul>

      <h2 id="questions">Questions and support</h2>
      <p>
        In the app, open More, then Help, to read answers or send a question to support. You can also ask your SampForce
        administrator, or contact Sampledge through the details your organisation was given when it signed up.
      </p>
    </article>
  );
}
