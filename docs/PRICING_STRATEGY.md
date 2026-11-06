# SampForce Pricing Strategy and Unit Economics

**Status:** rate card approved by Kunal (Sampledge) on 2026-10-31, after the proposal of 2026-10-30. The cost model
in sections 3 to 5 is still an estimate: check it against real usage from a beta and revisit prices if it is off.

**Phase 6 note:** the product enforces these allowances. Since 2026-10-31 it sells them by invoice, paid offline
(ADR 0013); Stripe and Razorpay checkout is built but switched off (docs/BILLING.md). The public `/pricing` page and the Billing page label the
rate card a preview until `PRICING_PUBLISHED=true` is set. The Helm chart sets it to true now that the rate card is
approved; local and test setups keep the preview labels.

## 1. Rate card (from the master brief, approved 2026-10-31)

| Plan | Monthly | Annual (per month) | Target |
|---|---|---|---|
| Free | $0 (up to 2 users) | $0 | Individuals |
| Launch | $8 / user | $6 / user | Startups |
| Growth | $15 / user | $12 / user | Growing teams |
| Professional | $29 / user | $23 / user | Advanced sales teams |
| Business | $49 / user | $39 / user | Established businesses |
| Enterprise | $79 / user | $65 / user | Large organizations |
| Enterprise Plus | Custom | Custom | Global enterprises |

USD, excluding taxes. Feature packaging per plan follows the brief and is mirrored in
`packages/types/src/plans.ts` (entitlements) and the `plans` table.

## 2. Published allowances (what makes the price predictable)

| Plan | AI credits / seat / month | Automation runs / tenant / month | Pipelines | API |
|---|---|---|---|---|
| Free | 50 | 500 | 1 | — |
| Launch | 200 | 2,000 | 3 | — |
| Growth | 500 | 10,000 | 10 | ✓ |
| Professional | 1,000 | 50,000 | 25 | ✓ |
| Business | 2,000 | 150,000 | 50 | ✓ |
| Enterprise | 3,000 | 500,000 | Unlimited | ✓ |

- **1 AI credit = one standard Copilot/agent step** (≈3k input + 0.5k output tokens on the fast tier).
  Deep-reasoning steps cost 4 credits. Credits are pooled across the tenant's seats and reset monthly.
- **Overage:** AI credit packs (proposed $10 per 1,000 credits). SMS, voice and WhatsApp are passed through at
  provider cost plus a published margin; SampForce never promises unlimited inference, messaging or third-party usage.
- **Single sign-on (OpenID Connect) and SCIM provisioning are on every plan, including Free** (decided 2026-10-31).
  They are not used as an upgrade lever; seats still count toward each plan's user limit.
- **No mandatory onboarding fee** on self-service plans; no seat minimums below Business; storage and
  integration limits published on the pricing page.

## 3. Cost inputs

Vendor prices were read from vendor pages on 2026-10-30 (full table with URLs:
[research/cost-inputs-2026-10-30.md](research/cost-inputs-2026-10-30.md)):

| Input | Price |
|---|---|
| Claude Haiku 5.5 (fast tier) | $0.10 / $0.50 per 1M input/output tokens |
| Claude Sonnet 5.5 (balanced tier) | $2 / $10 per 1M tokens |
| Amazon SES | $0.10 per 1,000 emails |
| S3 Standard (us-east-1) | $0.023 per GB-month |
| RDS PostgreSQL db.m7g.large (us-east-1) | $0.168 per hour |
| Stripe (US cards) | 2.9% + $0.30 per charge, plus Billing 0.7% |
| Razorpay (India) | 2% + GST (page also shows a 2.15% platform fee line) |
| Twilio US SMS | $0.0083 per segment + carrier fees |

Everything else in the model (utilisation, support cost, churn, CAC, fixed opex, team size) is an
**assumption**, listed at the top of [`pricing/unit_economics.py`](pricing/unit_economics.py).

## 4. Results (base case)

Full output: [pricing/unit-economics-output.md](pricing/unit-economics-output.md).

| Plan | Gross margin, monthly billing | Gross margin, annual billing | LTV:CAC (annual) | CAC payback |
|---|---|---|---|---|
| Launch | 74% | 67% | 1.9 | 14.9 months |
| Growth | 80% | 77% | 3.4 | 9.7 months |
| Professional | 82% | 79% | 6.0 | 8.3 months |
| Business | 85% | 82% | 9.7 | 6.9 months |
| Enterprise | 85% | 83% | 13.5 | 7.4 months |

- Blended contribution ≈ **$13.68 per paid seat per month** (mix 35/30/20/10/5% Launch→Enterprise, annual).
- Free seats cost ≈ $0.85/month each. At 3 free seats per paid seat, break-even on a placeholder
  $60k/month fixed opex is ≈ **5,400 paid seats**.
- AI is not the largest cost at these allowances: support and payment fees dominate on low-priced plans.
  AI becomes material only if usage shifts to the balanced tier; at 100% balanced-tier usage, Enterprise
  full-allowance AI cost rises from ~$8 to ~$33 per seat per month, which is why credits are weighted by tier.

## 5. Is the proposed pricing sustainable?

**Gross margin: yes**, under these assumptions, for every paid plan (67–85%).

**Customer economics: weak at the bottom.** Launch on annual billing has LTV:CAC ≈ 1.9 and a ~15-month
payback, below the common 3:1 / 12-month guidance. Recommendations:

1. **Launch annual: raise to $7/user/month** (still below $8 monthly) **or** keep $6 but acquire Launch only
   through zero-touch self-serve (target CAC ≤ $40/seat) with no sales assistance.
2. **Keep support self-serve on Free and Launch** (docs, community, in-app help); priority support from Business.
3. **Default the model router to the fast tier** and charge deep-reasoning steps 4 credits, so heavy AI use
   cannot erode Enterprise margins.
4. **Bill Free → paid upgrades annually by default** with monthly as an option; small monthly invoices lose
   ~4–6% to fixed card fees.
5. **India pricing:** model Razorpay fees and GST separately and consider INR price points rather than USD
   conversion.
6. **Re-run the model** after a 60–90 day beta with measured credit consumption, emails per seat, support
   tickets per seat and actual infrastructure bills.

## 6. Positioning against published competitor prices

Snapshot in [FEATURE_MATRIX.md](FEATURE_MATRIX.md) §1. Several competitors publish entry paid plans near
SampForce Launch (for example Freshsales Growth $9 and Close Solo $9 on annual billing), so the message
should be **predictability** (published AI allowances, no mandatory onboarding fees, clear add-ons) rather
than "cheapest". Any public comparison needs re-verified vendor pages and legal review.
