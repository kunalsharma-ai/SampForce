# Release checklist

Run through this before each release. Tick on desktop Chrome, Safari, Firefox, and on one real iPhone and one
Android phone.

## Build

- [ ] `npm ci && npm run build:all` finishes and `npm run check` shows four ✓ lines.
- [ ] `npm run preview` → page loads with no errors in the browser console.

## Content

- [ ] All buttons go to real pages (`links` in `site.js`), none to `#` or a placeholder email.
- [ ] Prices match the live pricing page.
- [ ] Competitor chart re-verified and legally approved, or hidden (`showCompetitorPrices: false`).
- [ ] Social image URL in `index.html` is absolute.
- [ ] Spelling and product names (SampForce, Sampledge) correct everywhere.

## Behaviour

- [ ] Hero: particles swirl, form the bolt, scatter; cursor pushes particles; the screen below flattens on scroll.
- [ ] Journey: the pinned screen changes for each of the six stages (desktop); stages show inline images (phone).
- [ ] Feature tiles tilt and light up under the cursor.
- [ ] Agents: hovering or tabbing to an agent updates the text in the centre.
- [ ] Globe: arcs travel, it spins on drag (mouse and touch).
- [ ] Flip cards flip on click, tap and Enter/Space.
- [ ] Tour: ring spins, drag changes speed, filter chips work, a click opens the lightbox; Escape and arrows work.
- [ ] Pricing toggle switches monthly/annual prices.
- [ ] Menu opens and closes on a phone; every menu link scrolls to its section below the fixed header.

## Accessibility and comfort

- [ ] With "Reduce motion" on (macOS: Accessibility → Display; Windows: Settings → Accessibility → Visual effects;
      iOS/Android: accessibility settings) the bolt is still, the marquee and loops stop, and nothing slides.
- [ ] Keyboard only: Tab reaches every button and link with a visible focus ring; "Skip to content" appears first.
- [ ] Zoom to 200%: nothing overlaps or is cut off.
- [ ] No horizontal scrolling at 360 px wide.

## Performance

- [ ] Lighthouse (mobile) Performance ≥ 70, Accessibility ≥ 90 on the deployed URL.
- [ ] The hero stays smooth on a mid-range phone; if not, lower `count` for small screens in `heroField.js`.
