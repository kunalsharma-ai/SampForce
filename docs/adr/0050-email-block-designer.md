# ADR 0050: Email template designer

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec follow-ups (Part 9, "Email Template Designer")

## Context

The spec asks for an email template designer with drag-and-drop blocks for text, images, buttons, headers,
footers, social links, signatures, dividers, product sections, pricing tables and personalised fields, with
desktop and mobile previews. SampForce's templates were plain text: sequences sent a text part, plus an HTML copy of
the same text when open or click tracking was on.

## Decision

1. **A design is data, not HTML.** A designed template stores an ordered list of typed blocks plus a small theme
   (accent, text, email and page background colours, and a sans or serif font) in `email_templates.design` (JSONB,
   null for plain text). The shape is one zod schema in `@dealflow/types` (`emailDesignSchema`), checked on save by
   the API and before save in the browser. People never type HTML, so there is nothing to sanitise: every piece of
   text is escaped when it is rendered.
2. **One renderer for every place an email is shown or sent.** `renderEmailDesign` (in `@dealflow/types`) turns a
   design into email HTML (table layout, inline styles, 600 px wide and fluid below that, bulletproof buttons) and a
   plain-text part. The designer's live preview, the "Preview for a lead" panel, test sends and real sequence sends
   all call it, so what people see is what goes out.
3. **Links are checked twice.** Button, image, product, social and website links must be `https://`, `http://` or
   `mailto:` addresses, or merge fields such as `{{var.booking_link}}`. After merge fields are filled in, a link
   that is no longer a web or mail address is dropped rather than sent. Images must be public `https://` links,
   because email apps block everything else; SampForce does not host email images.
4. **Personalised fields are the existing merge fields.** Any text in a block can hold `{{first_name|there}}`,
   custom fields and workspace variables, inserted with the same buttons as plain templates. Saving checks that
   custom fields and variables exist; a sequence pauses for a person whose field is empty with no fallback, exactly
   as for plain text. Merged values are escaped.
5. **The body stays useful.** A designed template's `body` holds its plain-text version with merge fields as typed
   (`designedTemplateBody`). The template list, the one-off email composer ("Insert a template" inserts this text)
   and AI writing help keep working on it, and it is the text part of the sent email.
6. **Sending.** A sequence step that uses a designed template and does not write its own text is sent as HTML with
   the text part beside it. With click tracking on, web links go through the signed click redirect (mailto links are
   left alone); the unsubscribe line and, with open tracking on, the open pixel are added inside the email. A step
   that writes its own text is sent as plain text, as before. Test sends render the design too, untracked, with a
   note that it is a test.
7. **The designer.** Templates get a Plain text / Designed switch; switching keeps both versions while the form is
   open, and a new design starts from the text written so far. The designer has a palette (click to add after the
   selected block, or drag into the email), the email's outline (drag to reorder, or use the move up and down
   buttons, which are the keyboard path), settings for the selected block, the look, and a live preview at desktop
   and 375 px phone width. The preview is a sandboxed frame with no scripts. Unfinished buttons and images show in
   the preview as placeholders, and saving names the block that still needs something.

## Consequences

- Designed emails are sent through the person's own Gmail or Outlook mailbox like every other sequence email. They
  are one-to-one sales emails with a designed layout, not bulk newsletters: daily limits, send windows,
  suppression and unsubscribe all apply unchanged.
- Rendering is in the shared types package, so a change to how blocks look changes the preview and the sent email
  together. The API and browser tests check both.
- The one-off composer sends the plain-text version of a designed template. Sending HTML from the composer would need
  an HTML-aware editor there; it is not part of this change.

## Not in this change

Uploading or hosting images, saved brand kits or reusable sections, more than one column per row, dark-mode
variants of the email, and HTML from the one-off composer.
