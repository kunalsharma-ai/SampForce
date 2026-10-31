# DealFlow lead capture (browser extension)

Chrome and Edge extension (Manifest V3) that finds email addresses on the page you are reading and saves the people as
leads in your DealFlow workspace. Design and security: [ADR 0015](../../docs/adr/0015-browser-extension.md).

## Build

```bash
pnpm --filter @dealflow/extension build   # dist/ and dealflow-extension-<version>.zip
```

## Install (until it is in the Chrome Web Store)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on Developer mode.
2. Choose **Load unpacked** and pick `apps/extension/dist`.
3. In DealFlow, go to Integrations → Browser extension and create a connection code.
4. Click the DealFlow icon in the toolbar, enter your DealFlow address and paste the code.

## Tests

- `pnpm --filter @dealflow/extension test`: the page reader (address and name detection).
- `apps/web/e2e/extension.spec.ts`: loads the extension into Chromium against a stand-in company site and the real
  API: connect, scan, save, duplicate handling, automatic capture and disconnect.
