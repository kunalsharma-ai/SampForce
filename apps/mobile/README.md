# SampForce mobile app

iOS and Android app for SampForce (Expo, ADR 0072). Same server, accounts and permissions as the web app.

## Run it

```bash
pnpm install
pnpm --filter @dealflow/types build
cd apps/mobile
pnpm start          # Expo dev server: scan the QR code with Expo Go, or press i / a for a simulator
pnpm test           # unit tests
pnpm build          # web export used by the end-to-end test (apps/web/e2e/mobile-app.spec.ts)
```

At sign-in, open "Use another server" to point the app at a local API (for example `http://localhost:4000`, or
`http://10.0.2.2:4000` from the Android emulator). The organisation must be approved by the Console and switched on by
its Super Workspace first.

## Before the stores

Store builds and submission come in M9. What the SampForce team will need then:

- Apple Developer Program account (organisation enrolment) and an App Store Connect app for `com.sampledge.sampforce`.
- Google Play Console account and an app with package `com.sampledge.sampforce`.
- An Expo account for EAS Build and Submit.
- Public privacy policy and support URLs, and a demo login for the reviewers.
- For push notifications (M8): an APNs key from Apple and a Firebase project for Android.
