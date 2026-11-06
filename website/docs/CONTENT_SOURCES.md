# Where every claim on the page comes from

The page follows the same honesty rules as the product docs: no competitor is said to *lack* anything, numbers come
from the shipped product or from dated vendor pages, and nothing is called "tested live" that wasn't.

## Product facts (from the SampForce codebase, November 2026)

| Claim on the page | Source |
|---|---|
| 10 AI agents and their names | `packages/types/src/ai.ts` (agent definitions: Copilot, Lead Qualification, Deal Intelligence, Meeting Notes, Proposal Draft, Workflow Builder, Forecast Explainer, Email Assistant, Voice Assistant, Retention Advisor) |
| Agents have tool allowlists, approval tiers, credit caps, audit trail, kill switch, live usage | `docs/AI_AND_AUTOMATION.md`, AI Agents page (`/app/agents`) |
| Copilot reads straight away, changes wait for confirmation | Copilot panel text and behaviour (`/app` → Copilot) |
| SSO (OpenID Connect) + SCIM on every plan including Free | `docs/PRICING_STRATEGY.md` §2 (decided 2026-10-31) |
| Two-step verification, recovery codes, lockout, device sign-out | Phase 8, `docs/SECURITY_MODEL.md` |
| Row-level security tenant isolation | ADR 0003, `scripts/check-rls.sql` |
| Encrypted secrets and key rotation | `docs/runbooks/key-rotation.md` |
| WCAG 2.2 AA checks on key pages, light and dark | Playwright + axe suite in `apps/web/e2e` (checks, not a certification) |
| 5 languages incl. Arabic right-to-left, Arabic PDFs | ADR 0047, 0052, 0054 |
| 12 themes + custom brand colours, readability check | Theme Studio (ADR 0040) |
| 4 motion levels incl. off, low-power mode, 2D alternatives for 3D views | ADR 0040, ADR 0011 |
| 10 bid templates, Quick Bid Studio | ADR 0045 |
| 9+ workspace apps (Slack, Teams, Zoom, DocuSign, WhatsApp, Twilio, Zapier, Stripe, Razorpay) | ADRs 0032–0039. The page says "connected with your own accounts"; these were tested against stand-ins, not live accounts, so do not claim live certification. |
| Plans, prices, AI credits, automation runs, pipelines | Approved rate card, `docs/PRICING_STRATEGY.md` §1–2 (approved 2026-10-31) |
| "Save up to 25%" on annual | Launch: $8 → $6 = 25%; other plans 18–21% |
| No mandatory onboarding fee on self-service plans; no seat minimum below Business | `docs/PRICING_STRATEGY.md` §2 |
| Chrome & Edge lead capture, email finder, prospect lists, visitor intelligence | Phase 9 and enhancement programme (ADR 0015, 0016, 0029, 0030). Not yet in the Chrome Web Store. |

## Competitor statements

Source: `docs/research/competitor-research-2026-10-30.md` and `docs/FEATURE_MATRIX.md` §1 (vendor pages read on
30 Oct 2026, US visitor, list prices).

The **flip cards** describe patterns ("AI is often sold as credits…", "Some vendors state required onboarding
fees…") without naming anyone. Each pattern appears on at least one vendor page in the research file, e.g. HubSpot
credits and required onboarding ($1,500 / $3,500), Microsoft Copilot Credits, Freshsales Freddy sessions,
monday CRM 3-seat minimum, Creatio 5-seat minimum (third-party report).

The **price chart** names vendors and shows each one's lowest published paid plan on annual billing:

| Bar | Price | Note |
|---|---|---|
| SampForce Launch | $6 | annual; $8 monthly |
| Freshsales Growth | $9 | annual |
| Close Solo | $9 | annual ($19 monthly) |
| Nutshell | $13 | billing term as stated on page |
| Pipedrive Lite | US$14 | annual |
| Copper Basic | $23 | annual ($29 monthly) |
| Salesforce Starter Suite | $25 | |
| Insightly Plus | $29 | annual |
| Dynamics 365 Sales Professional | $65 | annual |

Left out on purpose: HubSpot (Starter price/term pairing unclear on the page), Zoho (INR only), monday CRM
(3-seat minimum makes per-seat comparison misleading), Creatio and ActiveCampaign (not verified on their own pages),
Keap (flat price), SAP (price on request).

### Before the chart goes live

`docs/FEATURE_MATRIX.md` §3 requires this before any public comparison:

1. Re-open every vendor page above and update prices that changed (they change often).
2. Have legal review the comparative statements.
3. Keep the footnote: date, "list prices change often", "plans differ in what they include".

If that can't happen before launch, set `showCompetitorPrices: false` in `src/content/site.js`. The flip cards can
stay, because they name no vendor.

## Screens

All screenshots are of the real app running locally on 6 Nov 2026, in two demo workspaces with synthetic data
(the app's own "Demo workspace: all records here are synthetic development data" banner is visible). Company and
person names are made up. The Copilot answer in the Copilot screen came from the test AI stand-in used by the app's
own test suite, not from a live model, so its wording is illustrative of the flow (answer, proposed change, confirm).

The hero "event cards" (Copilot proposed a follow-up, Deal moved to Negotiation, Lead score 87, Quote accepted) are
illustrations of events SampForce records, not live data.
