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

## Build an Android APK

You need Node 26, pnpm 10 (`npm install -g pnpm@10.28.0`), JDK 17 and the Android SDK (install Android Studio, then set
`ANDROID_HOME`, for example `~/Library/Android/sdk` on a Mac or `%LOCALAPPDATA%\Android\Sdk` on Windows).

```bash
pnpm install                              # at the repository root
pnpm --filter @dealflow/types build
cd apps/mobile
npx expo prebuild --platform android --clean
cd android
./gradlew assembleRelease                 # Windows: gradlew.bat assembleRelease
```

The APK is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. Copy it to a phone and open it (allow
"install unknown apps"). This build is signed with the debug key, so it is for testing, not for Google Play.

The app signs in to `extra.apiUrl` in `app.json` (`https://app.sampforce.com`); change it before building to use another
server, or use "Use another server" on the sign-in screen. Release builds only talk to `https://` servers.

With Expo instead (no Android SDK needed): `npx eas-cli login`, `npx eas-cli init`, then
`npx eas-cli build --platform android --profile preview`, which gives a link to download the APK.

## Before the stores

Store builds use `eas.json` (ADR 0072, M9). What the SampForce team needs:

- Apple Developer Program account (organisation enrolment) and an App Store Connect app for `com.sampledge.sampforce`.
- Google Play Console account and an app with package `com.sampledge.sampforce`.
- An Expo account for EAS Build and Submit.
- Public privacy policy and support URLs, and a demo login for the reviewers.
- For push notifications (M8): an APNs key from Apple and a Firebase project for Android.
