# ADR 0054: Arabic quote, proposal and contract PDFs

- Status: Accepted
- Date: 2026-11-03
- Builds on: ADR 0052 (server text in the reader's language), ADR 0009 (commercial documents)

## Context

ADR 0052 translated the quote, proposal and contract PDFs, but pdfkit's built-in fonts (Helvetica, Times) cover
Latin-1 only. Arabic readers therefore got English PDFs, and Arabic that people typed (a company name, terms) printed
as question marks in every language.

Drawing Arabic needs three things the built-in fonts cannot give: glyphs for the script, shaping (each letter takes
an initial, medial, final or isolated form, and some pairs such as lam-alef join into one glyph), and the Unicode
bidirectional algorithm, so a line such as "التاريخ: 2026-11-02" keeps the date left to right inside right-to-left
text.

## Decision

- **Bundled fonts.** `apps/api/assets/fonts/` holds IBM Plex Sans Arabic (regular and bold) for the default look and
  Amiri (regular and bold) for serif bid templates, with their SIL Open Font License texts. The OFL allows bundling
  and embedding; pdfkit embeds only the glyphs a PDF uses. The fonts ship inside the API image with the package.
  Both fonts have one glyph per shaped letter form. Fonts that build letters from a dotless base plus separate dots
  (Noto Sans and Noto Naskh Arabic, tried first) cannot be read back: copy and search returned wrong letters.
- **Shaping** is fontkit's (pdfkit's font engine), which applies the fonts' OpenType Arabic features.
- **Ordering** is bidi-js 1.0.3 (MIT, conformant with UAX #9). `PdfText` (`apps/api/src/commercial/pdf-text.ts`)
  wraps each paragraph at spaces, reorders every line for display, and draws it run by run: Latin runs in Helvetica
  or Times, Arabic runs in the Arabic font, on one shared baseline. Brackets in right-to-left runs are mirrored.
  Numbers joined by hyphens ("2026-11-02", "+966-55-123") are wrapped in a left-to-right isolate first; after Arabic
  letters the algorithm otherwise treats their digits as Arabic numbers that a hyphen does not join, and dates print
  as "02-11-2026".
- **Layout.** A PDF in Arabic (the request language is `ar`) is mirrored: boxes are placed from the right margin,
  left and right alignment swap, the table's item column is on the right and amounts on the left, and the DocuSign
  anchors move with their signature lines. Any other PDF keeps its layout; it switches to the shaping path only when
  its text contains Arabic, and PDFs without Arabic are drawn with the built-in fonts exactly as before.
- **Readable text.** pdfkit writes a map from glyphs back to characters for copy, search and screen readers. A
  ligature glyph sits in a right-to-left run, which readers turn back into reading order, so its entry must be in
  display order; `PdfText.end()` reverses the multi-character Arabic entries before the document is written. This
  relies on pdfkit 0.15's `EmbeddedFont.unicode`; the version is pinned and the tests read the text back.

## Consequences

- Arabic readers get quotes, proposals and contracts in Arabic, laid out right to left.
- Arabic typed by people prints in every PDF.
- Scripts other than Latin-1 and Arabic (Hebrew, Cyrillic, Greek, CJK) still print as question marks; each would
  need its own font in the same structure.
- The API image grows by about 1.3 MB of font files.
- Arabic-Indic digits are drawn left to right; Node's ICU writes Western digits for `ar`, so amounts and dates use
  Western digits, as the web app does.
- Tests: `apps/api/src/commercial/pdf-arabic.test.ts` reads the PDFs back through the fonts' maps and checks the
  words, the right-to-left placement, dates, ligatures, the serif font, page breaks, and that PDFs without Arabic
  embed no font.
