# Chrome Web Store and Edge Add-ons listing kit

Everything the store forms ask for, written to match what the code in `apps/extension` does. Sampledge submits it
from its own developer account; nothing here has been submitted yet.

## What Sampledge needs to do

1. **Chrome:** register a Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole (Google
   charges a one-time registration fee) and verify the contact email. **Edge:** register at Partner Center
   (https://partner.microsoft.com/dashboard/microsoftedge).
2. **Publish the privacy page.** It is at `/extension-privacy` on the DealFlow site, for example
   `https://<your DealFlow domain>/extension-privacy`. Have your legal adviser read it before you publish the listing.
   It describes what the extension does; it does not by itself make anyone compliant with privacy law.
3. **Build the package:** `pnpm --filter @dealflow/extension build` gives `apps/extension/dealflow-extension-<version>.zip`.
   Upload that zip, not `dist-test` (the test build has extra site access for automated tests).
4. Fill the forms with the text below, upload the images in this folder, and submit for review. Review times vary.
5. Optional: after the first listing is live, put its store link on DealFlow's Integrations page instead of the
   "load unpacked" steps.

## Store listing

**Name:** DealFlow lead capture

**Summary** (132 characters at most):
Find the email addresses on any company website and save the people as leads in your DealFlow workspace.

**Description:**

DealFlow lead capture works with your DealFlow CRM workspace. Open it beside any company's website to see the email
addresses on the page, check who is already in DealFlow, and save the right people as leads in one click.

- Finds the addresses written on the page you are reading, with the names shown next to them.
- Checks your workspace first, so nobody is added twice, and flags anyone on your do-not-email list.
- "Find more people" asks DealFlow's email finder to read the company's public website for more contacts and works
  out how its addresses are written.
- Save people straight into an email sequence, if your mailbox is connected in DealFlow.
- Optional automatic capture saves new people at a company's own domain as you browse, never personal mailboxes
  such as Gmail, at most 100 a day. It is off until you turn it on.

You need a DealFlow workspace. Connect the extension with a connection code you create in DealFlow under
Integrations, Browser extension. The extension only talks to your own workspace, and you can disconnect it at any time.

**Category:** Workflow & Planning (Edge: Productivity)

**Language:** English

**Images in this folder:**
- `screenshot-1-scan.png` … `screenshot-5-email-finder.png`: 1280 × 800 screenshots. They show a made-up company
  ("Kestrel Analytics") and the "Northwind Research (demo)" workspace, so no real person's data appears.
- `promo-tile-440x280.png`: small promotional tile.
- Store icon: `apps/extension/src/icons/icon-128.png`.

**Privacy policy URL:** `https://<your DealFlow domain>/extension-privacy`

**Support / homepage URL:** your DealFlow site address.

## Privacy practices form

**Single purpose:** Find email addresses on web pages and save the people as leads in the user's own DealFlow CRM
workspace.

**Permission justifications:**

| Permission | Why it is needed |
|---|---|
| `storage` | Keeps the DealFlow address, the connection code and the automatic capture setting on the device, so the person stays connected. |
| `sidePanel` | The extension's interface is a side panel next to the page being read. |
| `scripting` | Runs the page reader on the current tab, when the person opens the panel or presses Scan, or on page load when they have turned on automatic capture, to find email addresses on it. |
| `contextMenus` | Adds "Find emails on this page with DealFlow" to the page's right-click menu. |
| Optional host access (`https://*/*`, `http://*/*`) | Requested only when the person presses "Allow page access" or turns on automatic capture, so the reader can run on the sites they visit, and to reach the DealFlow address they entered (which differs per customer). |

**Remote code:** No. All code is in the package; the extension only exchanges JSON with the person's DealFlow workspace.

**Data the extension handles** (tick these in the form):
- Personally identifiable information: email addresses and names found on pages and saved as leads.
- Website content: the page address, title and published company name.
- Web history: with automatic capture on, it keeps the addresses of pages checked in the last 24 hours on the device,
  so it does not check them twice, and sends the page address of each saved lead as its source.
- Authentication information: the DealFlow connection code, stored on the device.

**Certifications** (Sampledge confirms these; the code is built to meet them):
- Data is not sold or transferred to third parties outside the approved use cases.
- Data is not used or transferred for purposes unrelated to the single purpose.
- Data is not used or transferred to determine creditworthiness or for lending.

## Keep in step

If the extension's permissions, storage or network calls change, update this file and the privacy page
(`apps/web/src/app/(site)/extension-privacy/page.tsx`) in the same pull request.
