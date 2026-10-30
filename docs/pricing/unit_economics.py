"""DealFlow unit-economics model.

Run:  python3 docs/pricing/unit_economics.py  > docs/pricing/unit-economics-output.md

VENDOR PRICES come from docs/research/cost-inputs-2026-10-30.md (vendor pages, accessed 2026-10-30).
ASSUMPTIONS are DealFlow planning estimates, not measurements. Change them here and re-run; every
number in PRICING_STRATEGY.md section 4 is produced by this script.
"""

# ---------------- Vendor prices (verified 2026-10-30) ----------------
HAIKU_IN, HAIKU_OUT = 0.10, 0.50          # USD per 1M tokens, Claude Haiku 5.5 (prompts <=100K)
SONNET_IN, SONNET_OUT = 2.00, 10.00       # USD per 1M tokens, Claude Sonnet 5.5
SES_PER_1000 = 0.10                       # Amazon SES, USD per 1,000 emails
S3_GB_MONTH = 0.023                       # S3 Standard, first 50 TB, us-east-1
RDS_M7G_LARGE_HR = 0.168                  # RDS PostgreSQL db.m7g.large single-AZ, us-east-1
STRIPE_PCT, STRIPE_FIXED = 0.029, 0.30    # US domestic card
STRIPE_BILLING_PCT = 0.007                # Stripe Billing

# ---------------- Assumptions (edit freely) ----------------
CREDIT_TOKENS_IN, CREDIT_TOKENS_OUT = 3_000, 500   # one AI credit = one typical copilot/agent step
FAST_SHARE = 0.80                                    # share of credits served by the fast tier
AI_UTILISATION = 0.40                                # average share of the allowance actually used
EMAILS_PER_SEAT = 1_000                              # transactional + sequence emails per seat per month
STORAGE_GB_PER_SEAT = 2.0
COMPUTE_PER_SEAT = 0.35                              # app containers, Redis, search, observability share
DB_CLUSTER_MONTHLY = RDS_M7G_LARGE_HR * 730 * 2      # primary + standby
SEATS_PER_DB_CLUSTER = 5_000
SEATS_PER_INVOICE = {"monthly": 4, "annual": 4}      # typical small-team tenant
SUPPORT_PER_SEAT = {"free": 0.25, "launch": 1.00, "growth": 1.25, "professional": 2.50,
                    "business": 3.00, "enterprise": 5.00}
MONTHLY_CHURN = {"launch": 0.035, "growth": 0.03, "professional": 0.02, "business": 0.015, "enterprise": 0.01}
CAC_PER_SEAT = {"launch": 60, "growth": 90, "professional": 150, "business": 220, "enterprise": 400}
FIXED_OPEX_MONTHLY = 60_000      # team, tooling, base platform; placeholder for Sampledge to replace

PLANS = {  # code: (monthly price, annual-equivalent monthly price, AI credits per seat)
    "free": (0, 0, 50),
    "launch": (8, 6, 200),
    "growth": (15, 12, 500),
    "professional": (29, 23, 1_000),
    "business": (49, 39, 2_000),
    "enterprise": (79, 65, 3_000),
}


def credit_cost() -> float:
    fast = (CREDIT_TOKENS_IN * HAIKU_IN + CREDIT_TOKENS_OUT * HAIKU_OUT) / 1e6
    balanced = (CREDIT_TOKENS_IN * SONNET_IN + CREDIT_TOKENS_OUT * SONNET_OUT) / 1e6
    return FAST_SHARE * fast + (1 - FAST_SHARE) * balanced


def infra_per_seat() -> float:
    return (COMPUTE_PER_SEAT + DB_CLUSTER_MONTHLY / SEATS_PER_DB_CLUSTER
            + STORAGE_GB_PER_SEAT * S3_GB_MONTH + EMAILS_PER_SEAT / 1000 * SES_PER_1000)


def payment_fee_per_seat(price: float, billing: str) -> float:
    if price == 0:
        return 0.0
    seats = SEATS_PER_INVOICE[billing]
    months = 12 if billing == "annual" else 1
    invoice = price * seats * months
    fee = invoice * (STRIPE_PCT + STRIPE_BILLING_PCT) + STRIPE_FIXED
    return fee / seats / months


def row(code: str, billing: str):
    monthly, annual, credits = PLANS[code]
    price = annual if billing == "annual" else monthly
    ai = credits * AI_UTILISATION * credit_cost()
    ai_max = credits * credit_cost()
    infra = infra_per_seat()
    support = SUPPORT_PER_SEAT[code]
    pay = payment_fee_per_seat(price, billing)
    cogs = ai + infra + support + pay
    contrib = price - cogs
    gm = contrib / price if price else None
    return dict(code=code, billing=billing, price=price, ai=ai, ai_max=ai_max, infra=infra,
                support=support, pay=pay, cogs=cogs, contrib=contrib, gm=gm)


def main() -> None:
    cc = credit_cost()
    print(f"AI cost per credit (blended): ${cc:.5f}  ·  infra per seat: ${infra_per_seat():.2f}"
          f"  ·  DB cluster ${DB_CLUSTER_MONTHLY:,.0f}/mo\n")
    print("| Plan | Billing | Price/seat | AI (typical) | AI (full allowance) | Infra | Support | Payments | COGS | Contribution | Gross margin |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    rows = []
    for code in PLANS:
        for billing in ("monthly", "annual"):
            if code == "free" and billing == "annual":
                continue
            r = row(code, billing)
            rows.append(r)
            gm = f"{r['gm']:.0%}" if r["gm"] is not None else "n/a"
            print(f"| {code} | {billing} | ${r['price']:.2f} | ${r['ai']:.2f} | ${r['ai_max']:.2f} | ${r['infra']:.2f} | "
                  f"${r['support']:.2f} | ${r['pay']:.2f} | ${r['cogs']:.2f} | ${r['contrib']:.2f} | {gm} |")

    print("\n| Plan (annual) | Contribution/seat/mo | Monthly churn | LTV per seat | CAC per seat | LTV:CAC | CAC payback (months) |")
    print("|---|---|---|---|---|---|---|")
    for code in ("launch", "growth", "professional", "business", "enterprise"):
        r = row(code, "annual")
        ltv = r["contrib"] / MONTHLY_CHURN[code]
        cac = CAC_PER_SEAT[code]
        print(f"| {code} | ${r['contrib']:.2f} | {MONTHLY_CHURN[code]:.1%} | ${ltv:,.0f} | ${cac} | {ltv / cac:.1f} | {cac / r['contrib']:.1f} |")

    free = row("free", "monthly")
    mix = {"launch": 0.35, "growth": 0.30, "professional": 0.20, "business": 0.10, "enterprise": 0.05}
    blended = sum(row(c, "annual")["contrib"] * w for c, w in mix.items())
    print(f"\nFree seat cost: ${free['cogs']:.2f}/mo (AI ${free['ai']:.2f} typical, ${free['ai_max']:.2f} at full allowance)")
    print(f"Blended contribution per paid seat (annual billing, mix {mix}): ${blended:.2f}/mo")
    for free_ratio in (0, 3, 5):
        per_paid = blended - free_ratio * free["cogs"]
        print(f"- With {free_ratio} free seats per paid seat: ${per_paid:.2f}/mo → break-even at "
              f"{FIXED_OPEX_MONTHLY / per_paid:,.0f} paid seats (fixed opex ${FIXED_OPEX_MONTHLY:,}/mo)")
    print(f"\nAI overage pack: 1,000 credits cost ${1000 * cc:.2f}; at a $10 list price the margin is {1 - 1000 * cc / 10:.0%}")


if __name__ == "__main__":
    main()
