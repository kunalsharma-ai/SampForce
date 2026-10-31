# DealFlow lead capture (browser extension)

Chrome and Edge extension (Manifest V3) that finds email addresses on the page you are reading and saves the people as
leads in your DealFlow workspace, and finds prospects at the company on screen through the workspace's Apollo.io key
(Mock Mode sample people without one). Design and security: [ADR 0015](../../docs/adr/0015-browser-extension.md) and
[ADR 0030](../../docs/adr/0030-prospect-lists-and-discovery.md).

## Build

```bash
pnpm --filter @dealflow/extension build   # dist/ and dealflow-extension-<version>.zip
```

## Install (until it is in the Chrome Web Store)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on Developer mode.
2. Choose **Load unpacked** and pick `apps/extension/dist`.
3. Click the DealFlow icon in the toolbar, enter your DealFlow address and sign in with your DealFlow email and
   password (and your two-step code if you use one).
4. Workspaces that require single sign-on: in DealFlow, go to Integrations → Browser extension, create a connection
   code, and paste it under "Or use a connection code".

## Store listing

`store/LISTING.md` has the Chrome Web Store and Edge Add-ons text, permission reasons and privacy answers;
`store/` also holds the screenshots and promo tile. The privacy page is `/extension-privacy` on the DealFlow site.

## Tests

- `pnpm --filter @dealflow/extension test`: the page reader (address and name detection).
- `apps/web/e2e/extension.spec.ts`: loads the extension into Chromium against a stand-in company site and the real
  API: connect, scan, save, duplicate handling, automatic capture and disconnect, and password sign-in with prospect
  discovery and import in Mock Mode.
- `apps/api/test/extension-prospects.e2e.test.ts`: sign-in (password, second factor, SSO-required), discovery, import
  to lists and the CRM, roles, and the Apollo stand-in.
