# ADR 0053: Every integration is set up from the operator console

- Status: Accepted
- Date: 2026-11-03
- Builds on: ADR 0051 (provider keys in the operator console)

## Context

ADR 0051 moved the deployment-wide provider keys into the operator console. Kunal asked that every integration be
set up from inside DealFlow, with no environment variables, config files or backend edits. An audit of
`packages/config/src/env.ts` against the console found three gaps:

1. **Settings that were still environment-only**: whether online payments are on (`ONLINE_PAYMENTS_ENABLED`), the
   Stripe price ids and Razorpay plan ids per plan (`STRIPE_PRICES`, `RAZORPAY_PLANS`), Stripe automatic tax,
   whether pricing is published, the sales contact address, and the Claude model (`AI_MODEL`). Some were read once
   at start-up (`BillingProviders`, the price maps, `AnthropicProvider.model`), so even an environment change needed
   a restart.
2. **No guidance**: the console took keys but did not say how to create them, and the redirect and webhook URLs a
   provider needs (Slack, Zoom, DocuSign, Google, Microsoft, Stripe, Razorpay) were only in the code.
3. **No proof that webhooks arrive**: Stripe, Razorpay, Zoom and DocuSign signing secrets were described as "proven
   when the first signed event arrives", but nothing showed whether one had.

Per-workspace integrations (Twilio, WhatsApp, card payments for quotes, Teams, SSO and SCIM) were already set up by
each workspace admin in Settings > Apps and Administration > Security, with their webhook URLs shown there.

## Decisions

1. **More managed settings.** `MANAGED_KEYS` gains `AI_MODEL`, `ONLINE_PAYMENTS_ENABLED`, `STRIPE_PRICES`,
   `STRIPE_AUTOMATIC_TAX`, `RAZORPAY_PLANS`, `PRICING_PUBLISHED` and `SALES_CONTACT_EMAIL`, all non-secret.
   `ProviderKeysService` now stores the typed value (a switch is saved as `"true"`/`"false"` and read as a boolean),
   and reports a `default` source when nobody set a value. Price maps are validated with the same parser the
   billing adapters use. Every reader now reads at call time.
2. **A "Plans and online checkout" group** in the Providers list holds those billing settings. It has no connection
   test (`checkable: false`; `checkout` is not in `PROVIDER_CHECK_KEYS`).
3. **Setup guides in the catalogue.** Each `PROVIDER_CATALOGUE` entry has steps, a link to the provider's console,
   and the URLs to paste there as paths. The API returns them as absolute URLs on `PUBLIC_WEB_URL`, built from the
   same paths the code uses, and a test checks the redirect URL in each guide equals the `redirect_uri` DealFlow
   sends.
4. **Webhook receipts.** `WebhookReceipts` records, per provider, the time and event type of the last event whose
   signature matched, with a fingerprint of the signing secret it matched, and the time and reason of the last one
   refused. Nothing from the body or headers is kept, and writes are throttled to one per 30 seconds per outcome. The
   console shows: waiting, verified, stale (a different secret is set now) or refused.
5. **What stays on the server is listed, with reasons.** `GET /operator/deployment` lists `DATABASE_URL`,
   `ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`, `OPERATOR_JWT_SECRET`, `PUBLIC_WEB_URL` and `WEB_ORIGINS`: whether each is
   set, the value only for the two that are not secret, and why it cannot move. The console reads and seals
   everything with the first four, and the last two are part of the server and domain setup.

## Kept in the environment on purpose

- The six bootstrap settings above.
- `*_API_BASE_URL` and `*_AUTH_BASE_URL` overrides. They exist to point tests at local stand-ins. Letting the console
  change them would let an operator session send provider keys to any server.
- Limits and timings (`EMAIL_DAILY_SEND_LIMIT`, rate limits, trial and grace days, timeouts). These are capacity
  settings for whoever runs the server, not integration setup. They can move later the same way if needed.
- `TRACKING_BASE_URL` / `TRACKING_SECRET`: optional. The defaults (`PUBLIC_WEB_URL` and a key derived from
  `JWT_ACCESS_SECRET`) work without setting anything.

## Consequences

- An operator can set up and switch on every integration from Providers, with no restart and no file edits.
- A value in the environment still works and the console still overrides it. Deployments that set
  `PRICING_PUBLISHED=true` in the environment keep it until someone changes it in the console.
- None of this is tested against the real providers yet. The guides follow each provider's documented console as of
  November 2026 and may drift when providers rename menus.
