# CRM Competitor Pricing & Capability Research

**Accessed:** 2026-10-30 (all sources below accessed this date)
**Method:** Vendor's own pricing page fetched for each product where possible. Text was extracted from the page; anything the extracted page text did not state is marked "not stated on vendor page". Comparison tables on several pages render checkmarks as icons, which do not survive text extraction. Where a feature appears in a table but its plan placement could not be read, this is flagged as "plan placement unclear". No figures come from memory.

**Caveats**
- Prices are list prices as displayed to the fetching client (US-based proxy) and can vary by region. Zoho served INR prices, not USD (see Zoho section).
- "Per user / month" means the vendor's own per-seat-per-month wording unless noted.
- Two vendors could not be fully verified from official sources: **Creatio** (vendor pricing page blocked/failed to fetch) and **ActiveCampaign** (vendor page fetched, but prices render client-side and showed only placeholders). For these, third-party figures are given and clearly marked.

---

## Summary table: entry and top published per-user prices

| Vendor | Entry paid plan (price) | Top published plan (price) | Billing basis of shown price | Currency | Source quality |
|---|---|---|---|---|---|
| Salesforce Sales Cloud | Starter Suite, $25/user/mo | Max, $550/user/mo | Starter: monthly or annual; others: billed annually | USD | Vendor page |
| HubSpot Sales Hub | Starter, "starts at" $7 or $20/seat/mo (page does not pair price to term) | Enterprise, "starts at" $150/seat/mo | Monthly / annual toggle; pairing unclear | USD | Vendor page |
| Zoho CRM | Standard, ₹800/user/mo (annual), ₹1,300 (monthly) | Ultimate, ₹2,600/user/mo (annual), ₹3,200 (monthly) | Both stated | INR (USD not shown to fetcher) | Vendor page (INR only) |
| Microsoft Dynamics 365 Sales | Sales Professional, $65/user/mo | Sales Premium, $150/user/mo (Relationship Sales: "Variable") | Paid yearly | USD | Vendor page |
| Pipedrive | Lite, US$14/seat/mo | Ultimate, US$79/seat/mo | Billed annually (monthly price not stated) | USD | Vendor page |
| monday CRM | Basic, $12/seat/mo | Pro, $28/seat/mo (Ultimate: custom price) | Appears to be yearly toggle; min. 3 seats | "$" (code not stated) | Vendor page |
| Freshsales | Growth, $9/user/mo | Enterprise, $59/user/mo | Billed annually | USD | Vendor page |
| Creatio | Growth, $40/user/mo (platform) + $15/user/mo per CRM product | Enterprise, $75/user/mo (Unlimited: custom) | Not verified; 5-seat min. reported | USD | **Third-party** (eesel.ai); vendor page failed |
| Close CRM | Solo, $19 monthly / $9 annual per user/mo | Scale, $149 monthly / $139 annual per user/mo | Both stated | "$" (code not stated) | Vendor page |
| Insightly CRM | Plus, $29/user/mo | Enterprise, $99/user/mo | Billed annually | USD | Vendor page |
| Copper CRM | Basic, $29 monthly / $23 annual per seat/mo | Business, $134 monthly / $99 annual per seat/mo | Both stated | USD | Vendor page |
| Nutshell CRM | $13/user/mo (tier name inferred: Foundation) | $79/user/mo (top tier, name not shown) | Monthly/annual toggle; basis of headline price unclear | "$" (code not stated) | Vendor page |
| ActiveCampaign | Starter, $15 (yearly) / $19 per month at 1,000 contacts | Enterprise, $145 (yearly) / $179 per month at 1,000 contacts | Priced per plan by contact count, not per user | USD | **Third-party** (emailvendorselection.com); vendor page showed no prices |
| Keap | Single plan, $299/mo monthly or $2,988/yr ($249/mo) | Same single plan; extra users $39/mo each | Both stated; per plan, 2 users included | "$" (code not stated) | Vendor page |
| SAP Sales Cloud | Version 2 base: "Price upon request" | Add-ons: field sales $47/user/mo, service $22/user/mo | Monthly; 3 to 36 month terms | USD (one add-on in EUR) | Vendor page |

---

## 1. Salesforce Sales Cloud

**Sources:**
- https://www.salesforce.com/sales/pricing?bc=HL (US page, fetched OK)
- https://salesforce.com/in/sales/pricing (also fetched; same USD figures plus other currencies)
- Note: https://www.salesforce.com/sales/pricing/ returned a client error.

**Editions (USD per user/month)**

| Edition | Price | Billing |
|---|---|---|
| Free Suite | $0 | Comparison table only |
| Starter Suite | $25 | "Billed monthly or annually" |
| Pro Suite | $100 | "Billed annually" |
| Core | $195 | "Billed annually" |
| Advanced | $395 | "Billed annually" |
| Max | $550 | "Billed annually" |

- Other currencies on the page: Starter AU$35 / £20 / €25 / ¥3,000 / 250 kr; Pro AU$140 / £80 / €100 / ¥12,000 / 1,000 kr; Core AU$273 / £156 / €195 / ¥23,400 / 1,950 kr; Advanced AU$553 / £316 / €395 / ¥47,400 / 3,950 kr; Max AU$770 / £440 / €550 / ¥66,000 / 5,500 kr.
- Seat minimums: not stated on vendor page.
- **Free plan/trial:** Free Suite ($0) is listed in the comparison table. 30-day free trial, "No credit card, no installations", covering all Sales Cloud editions. Starter Suite trial is for up to 10 users.

**AI / agents:** Agentforce for Sales. It is "Available for purchase" on Core and Advanced, from $125 USD/user/month (per-user add-on). Max includes "Agentforce for Sales and Agentforce Coworker" and "2.75M Flex Credits per org per year". The page also lists 500K and 1M Flex Credits per org, but which editions they belong to could not be read from the extracted text. The FAQ says "AI can be added to Core and above."

**Stated add-ons:** Sales Programs from $100/user/mo; Revenue Intelligence from $220/user/mo; Revenue Cloud from $200/user/mo; Partner Relationship Management from $10/login/mo; "Additional $25 USD/user/month" on what appears to be the Web Services API row (attribution not fully clear). Premier Success Plan is included with Core, Advanced and Max, and is an add-on for Pro Suite (no price). Onboarding fee: not stated on vendor page.

**Native capabilities (as stated)**
- Workflow builder: Yes (Flow Builder, Flow Orchestration, Approval Processes). Which editions get each could not be read.
- Sequences / email automation: Email integration, mass email, templates and email productivity are listed. "Sequences" is not named.
- Calling: No dialer named. "Call Summaries" appears under built-in AI.
- Forecasting: Yes (Advanced Forecast & Pipeline Management; Predictive Forecasting available for purchase).
- Quotes/CPQ: Quotes ("Create and track quotes and orders"; Pro Suite mentions sales quoting). CPQ is not named; Revenue Cloud is a separate add-on.
- Marketing automation: Not named. Campaign management, Campaign Influence and mass email are listed; Starter mentions email marketing.
- Mobile app: Yes (Salesforce Mobile App, offline).
- API access: Yes (Web Services API; the Core FAQ says Core includes APIs; $25/user/mo add-on note).

---

## 2. HubSpot Sales Hub

**Source:** https://www.hubspot.com/pricing/sales (fetched OK)

| Plan | Price (USD) | Notes |
|---|---|---|
| Free | $0 | "Free for up to 2 users." "No credit card required." |
| Starter | "Starts at" $7/mo/seat and $20/mo/seat | Toggle: Pay Monthly / Commit monthly / Pay Annually. The page text does not pair either price with a term. |
| Professional | "Starts at" $90/mo/seat and $100/mo/seat | Toggle: Pay Monthly / Commit annually / Pay Annually. Pairing not stated. |
| Enterprise | "Starts at" $150/mo/seat | "Talk to Sales". Billing term not stated. |

- Seat minimums: not stated on vendor page.
- Trial: not stated on vendor page (a free plan exists).
- Promo on page: Revenue Hub Professional $57/mo/seat (was $95) or Enterprise $98/mo/seat (was $140), billed annually, for new Sales Hub and Revenue Hub customers.

**AI / agents:** Customer Agent, Prospecting Agent and Data Agent, run on **HubSpot Credits** (usage-priced). Included credits: Starter 500, Professional 3,000, Enterprise 5,000 per month (reset monthly, no rollover). Additional credits cost **$0.010 per credit** (packs or Pay-as-You-Go). Which tiers get which agents could not be read from the extracted table.

**Stated fees:** **Required one-time onboarding: Professional $1,500; Enterprise $3,500.** Additional seats are described as an "additional monthly cost" with no amount.

**Native capabilities**
- Workflow builder: Starter up to 50 workflows (restricted triggers/actions); Professional up to 300; Enterprise up to 1,000.
- Sequences: Professional (5,000/account, up to 500 sends/user/day) and Enterprise (up to 1,000 sends/user/day).
- Calling: Starter 500 min, Professional 3,000 min, Enterprise 12,000 min; transcription on Professional and Enterprise.
- Forecasting: Professional (default and custom); Enterprise adds team hierarchies.
- Quotes/CPQ: Not listed as a Sales Hub feature. Enterprise mentions "quote-based workflows". The page points to Revenue Hub for CPQ.
- Marketing automation: Not stated on vendor page as a Sales Hub feature.
- Mobile app: A "HubSpot mobile app" row is in the comparison table; plan placement is unclear.
- API access: Not stated on vendor page.

---

## 3. Zoho CRM

**Sources:**
- https://www.zoho.com/crm/zohocrm-pricing.html (fetched OK; the price amounts did not render in the text, only "/user/month")
- https://www.zoho.com/crm/comparison.html (fetched OK; prices served in **INR**)
- https://www.zoho.com/crm/zohocrm-pricing.html?currency=USD (fetched; still no numeric prices)

**USD prices could not be verified from the vendor page.** The vendor served INR to the fetching client. The pricing page lists 15 selectable currencies, and local taxes are extra.

| Edition | Billed annually | Month-to-month |
|---|---|---|
| Free | Free for 3 users | — |
| Standard | ₹800/user/mo | ₹1,300/user/mo |
| Professional | ₹1,400/user/mo | ₹2,100/user/mo |
| Enterprise | ₹2,400/user/mo | ₹3,000/user/mo |
| Ultimate | ₹2,600/user/mo | ₹3,200/user/mo |

- Zoho CRM Plus (a bundle): "Starts at $20/user/month" (USD, on the pricing page).
- Seat minimums: not stated for the main editions. Lite users on Enterprise and Ultimate require "a minimum of 25 regular licenses".
- **Free plan/trial:** Free edition "Forever free, for 3 users", no credit card. Free trial on paid editions; length not stated on vendor page.

**AI:** Zia. Professional lists "AI agents" and "Predictive intelligence"; Enterprise lists "Extended AI capabilities". Per-edition Zia quotas (comparison page): Standard Data Enrichment 500 records/user (max 50,000); Professional Field Prediction 2/org and Zia Scores 5/org; Enterprise Churn Prediction 2/org, Anomaly Detector, Zia Scores 10/org; Ultimate Churn and Field Prediction 20/org. Whether AI is an add-on or usage-priced: not stated on vendor page (listed as edition features).

**Add-on / onboarding fees:** Not stated on vendor page. Paid support and "Jumpstart onboarding" are mentioned without prices.

**Native capabilities**
- Workflow builder: Yes, from Free (10 rules/module, 5 active) up to Ultimate (150 rules/module, 100 active).
- Sequences/email automation: Cadences on Standard (20/module) through Ultimate (70/module); mass email from Standard.
- Calling: "Built-in calling" on Standard. PhoneBridge appears in the comparison table but plan placement is unclear.
- Forecasting: From Standard (5 forecasts) to Ultimate (20).
- Quotes/CPQ: CPQ from Professional (10 configurations); Enterprise 50; Ultimate 100.
- Marketing automation: Not named. Customer journeys (Professional), Account Based Marketing (Enterprise) and autoresponders are listed.
- Mobile app: Yes ("Mobile apps" in Free).
- API access: Yes (Free 5,000 calls/day; higher credits per edition).

---

## 4. Microsoft Dynamics 365 Sales

**Source:** https://www.microsoft.com/en-us/dynamics-365/products/sales/pricing (fetched OK; related link dynamics.microsoft.com/sales/pricing/ from search)

| Plan | Price | Billing |
|---|---|---|
| Sales Professional | $65.00/user/month | Paid yearly |
| Sales Enterprise | $105.00/user/month | Paid yearly |
| Sales Premium | $150.00/user/month | Paid yearly ("Contact us") |
| Microsoft Relationship Sales (Enterprise + LinkedIn Sales Navigator) | "Variable" | Contact sales |

- **Seat minimum:** "Requires a 10-seat minimum" appears next to the Relationship Sales card. It is most likely for that plan, but the extracted text does not say so outright.
- Page disclaimer: prices are informational and vary by currency, country and region.
- **Free trial:** "Dynamics 365 Sales free trial" is offered; length not stated on vendor page.

**AI / agents:** Copilot in Dynamics 365 (included capabilities in Sales, Outlook and Teams) plus agents (Sales Qualification, Opportunity, Research, and Close (Preview)). **Agents require Copilot Credits.** Sales Premium includes **1,000 Copilot Credits per user/month**. Extra credits come via Microsoft Copilot Studio, either **pay-as-you-go** or a **pre-purchase plan** ("Save up to 20%"). An Azure subscription is required. Per-credit price: not stated on this page.

**Stated add-ons:** Power Automate, Power Apps and Teams-based features "require additional licenses" (prices not stated). Onboarding fee: not stated on vendor page.

**Native capabilities**
- Workflow builder: "Customization and automation" with Power Automate (Professional is "Limited"; additional licenses required).
- Sequences/email automation: "Sales engagement" includes the sales accelerator (included capacity).
- Calling: Outbound calling and conversation intelligence (requires additional licenses).
- Forecasting: Yes (advanced SFA includes forecasting; predictive forecasting in advanced sales engagement).
- Quotes/CPQ: Quotes, orders, invoices, product/price lists and bundles. CPQ is not named.
- Marketing automation: Not stated on vendor page.
- Mobile app: Yes.
- API access: Not stated on vendor page.

---

## 5. Pipedrive

**Source:** https://www.pipedrive.com/en/pricing (fetched OK)

| Plan | Price (per seat/mo) | Billing |
|---|---|---|
| Lite | US$14 | Billed annually |
| Growth | US$39 | Billed annually |
| Premium | US$59 | Billed annually |
| Ultimate | US$79 | Billed annually |

- Monthly-billing prices: not stated in the fetched page text ("Save up to 42%" is shown). VAT is excluded.
- Seat minimums: not stated on vendor page.
- **Trial:** 14-day free trial, no credit card. Free plan: not stated on vendor page.

**AI:** All plans are labeled "Now with AI" (AI report creation on Lite; AI multi-email tools on Premium). Whether AI is included, an add-on or credit-priced: not stated on vendor page.

**Add-ons/onboarding:** Add-on prices (Campaigns, LeadBooster, Smart Docs, etc.) are not stated on the vendor page. Lite mentions "Personalized onboarding" with no fee.

**Native capabilities**
- Workflow builder: "Automations and nurturing sequences" on Growth. A workflow builder is not named separately.
- Sequences/email automation: Growth ("Automate emails and follow-ups").
- Calling: Not stated on vendor page.
- Forecasting: Growth ("Subscriptions and forecast reports").
- Quotes/CPQ: Not stated on vendor page. Premium lists "Contracts and e-signatures".
- Marketing automation: Not stated on vendor page (nurturing sequences only).
- Mobile app: Not stated on vendor page.
- API access: Not stated on vendor page ("500+ integrations").

---

## 6. monday CRM

**Source:** https://monday.com/crm/pricing (fetched OK)

| Plan | Price (per seat/mo) | Struck-through price |
|---|---|---|
| Basic | $12 | $18 |
| Standard | $17 | $25 |
| Pro | $28 | $41 |
| Ultimate (formerly Enterprise) | Custom price, contact sales | — |

- Currency code: not stated ("$"). Prices exclude tax.
- Billing: the "Yearly SAVE 33%" toggle appears to be the one selected. Yearly plans are paid upfront. A separate monthly per-seat price is not stated. The page is internally inconsistent: the FAQ says the yearly discount is 18%, and the meta description says "starting from $10".
- **Seat minimum: "Plans start from 3 users."** More than 40 users requires a quote.
- **Free/trial:** "Start free, no credit card needed"; the FAQ describes a 14-day trial.

**AI / agents:** monday AI. "AI credits are included" in Standard, Pro and Ultimate. Credit amounts and overage pricing are not stated on the vendor page. Agents listed: outreach caller agent, lead sourcer agent, build-your-own agent, meeting prep agent, AI meeting notetaker. Pro and Ultimate add an AI workflow builder.

**Add-ons/onboarding:** Not stated on vendor page (Ultimate lists "Tailored onboarding" and "White-glove migration", no price).

**Native capabilities**
- Workflow builder: Standard (250 automations/mo), Pro (25K/mo), Ultimate (enterprise scale).
- Sequences/email automation: Pro ("Set email sequences").
- Calling: Only via the AI outreach caller agent (Standard and up). Manual dialing is not stated.
- Forecasting: Not stated on vendor page.
- Quotes: Yes (Basic 20/mo, Standard 50/mo, Pro 250/mo, Ultimate unlimited).
- Marketing automation: Not named (mass emails on Pro; "monday campaigns" is a separate product).
- Mobile app: iOS/Android (listed from Standard).
- API access: Ultimate ("25,000 API calls / day").

---

## 7. Freshsales (Freshworks)

**Source:** https://www.freshworks.com/crm/pricing/ (fetched OK)

| Plan | Price (USD per user/mo) | Billing |
|---|---|---|
| Growth | $9 | Billed annually |
| Pro | $39 | Billed annually |
| Enterprise | $59 | Billed annually |

- Monthly prices: not stated in the fetched text (toggle "Save 20% Annually / Monthly").
- Seat minimums: not stated on vendor page.
- **Trial:** 21-day trial. Free plan: the meta description mentions "a free plan", but none appears in the plan listings.

**AI:** **Freddy AI Agent, an add-on at $49 per 100 sessions** (usage-priced, all plans). Whether any AI is included in base plans: not stated on vendor page.

**Stated add-ons:** Branded documents $19/user/mo; Freddy AI Agent $49/100 sessions. Onboarding fee: not stated on vendor page.

**Native capabilities**
- Workflow builder: "Basic workflows" (Growth).
- Sequences: Pro and up.
- Calling: "Chat, Email, and phone" listed on Growth (no details).
- Forecasting: "Forecasting insights" (Enterprise).
- Quotes/CPQ: Not stated on vendor page.
- Marketing automation: Not stated on vendor page.
- Mobile app: Not stated in plan content (app store links only).
- API access: Not stated on vendor page.

---

## 8. Creatio — NOT VERIFIED FROM VENDOR PRICING PAGE

**Vendor URLs attempted (all failed with client error):** https://www.creatio.com/pricing, https://www.creatio.com/pricing/, https://www.creatio.com/products/pricing

**Vendor page fetched (comparison landing, possibly outdated):** https://creatio.com/landings/creatio-vs-competitors/sales-enterprise-editions-comparison. It states the Creatio "Enterprise" platform plan at $55/user/month plus the "Sales" product at $15/user/month ($840/user/year). Third-party sources flag these as older figures.

**Third-party fallback (marked):** https://www.eesel.ai/blog/creatio-pricing (published 2026-08-25 by a competing vendor; cites creatio.com/products/pricing)
- Platform plans (USD per user/mo, **5-seat minimum**): Growth $40; Enterprise $75; Unlimited custom.
- CRM products (Sales, Marketing, Service): $15/user/mo each, on top of a platform seat.
- Minimum contract reported: $10,000/year for new customers; standard 3-year term.
- AI: annual AI credit packages: Start 500K credits $5,000/yr; Grow 1.5M $25,000; Accelerate 4M $75,000; Scale 8M $150,000; Freedom custom. Plans include 10/20/30 one-time AI Actions per user.
- Support: AI Support free; Business Support 10%; Premium Support 20% of subscription.
- Add-ons reported: Governance Application $50/user/mo; limited users $12/user/mo.
- Free trial: not verified.
- Native capabilities: not verified from a vendor page (the comparison landing page does not list features).

---

## 9. Close CRM

**Source:** https://www.close.com/pricing (fetched OK)

| Plan | Monthly billing | Billed annually | Notes |
|---|---|---|---|
| Solo | $19/user/mo | $9/user/mo | 1 user only; 10k leads cap |
| Essentials | $49 | $35 | |
| Growth | $109 | $99 | |
| Scale | $149 | $139 | |

- Currency code: not stated ("$"). Mapping of the two prices to monthly vs annual is inferred from toggle order ("SAVE UP TO 50%" on annual). Custom pricing is available for large teams.
- Seat minimums: not stated (Solo is capped at 1 user).
- **Trial:** 14 days, no credit card, includes $5 of calling/enrichment credits. There is also a 30-day money-back guarantee. No free plan.

**AI / agents:** **Chloe (AI sales agent)**, "free on all Close plans", using included AI credits per month with no rollover: Solo 500/user; Essentials 1,000/user (pool up to 10,000); Growth 1,500/user (up to 15,000); Scale 2,000/user (up to 20,000). Extra credits can be bought; price not stated.

**Stated add-ons:** Additional organizations $50/org/mo (Growth and Scale include 1 secondary org). An unlabeled add-on at "$50 / mo + $0.02 / min". Calling/SMS passed through at cost (~$0.02/min outbound). Phone numbers from ~$1/month. Onboarding fee: not stated on vendor page.

**Native capabilities**
- Workflow builder: Growth and Scale.
- Sequences/email automation: Email scheduling and bulk email (Growth and Scale). "Sequences" appears only in a help link.
- Calling: Built-in on all plans; Power Dialer on Growth and up; Predictive Dialer on Scale.
- Forecasting: Mentioned only in site navigation. Not in the plan matrix.
- Quotes/CPQ: Not stated on vendor page.
- Marketing automation: Not stated on vendor page.
- Mobile app: iOS/Android, all plans.
- API access: All plans (API keys/OAuth, event log).

---

## 10. Insightly

**Source:** https://www.insightly.com/pricing/ (fetched OK)

| CRM plan | Price (USD per user/mo) | Billing |
|---|---|---|
| Plus | $29 | Billed annually |
| Professional | $49 | Billed annually |
| Enterprise | $99 | Billed annually (contact sales) |

- Seat minimums: not stated for standalone CRM. The All-in-One bundles include 2/5/10 CRM users.
- **Trial:** 14-day free trial, no credit card (Plus and Professional). No free plan.
- Other products: Marketing $99 / $499 / $999 per account/mo; Service $29 / $49 / $99 per user/mo; AppConnect $249 / $799 / $1,899 per month (25K / 100K / 250K tasks); All-in-One $349 / $899 / $2,599 per month (billed annually).

**AI:** **AI Copilot**, included in Professional (75 queries) and Enterprise (100 queries). The time period for the query limits is not stated. No separate AI price. "CRM MCP" is mentioned with no price.

**Stated fees:** AppConnect required technical setup **$3,000**. All-in-One bundles list **required** fees: technical setup $3,000; **guided product onboarding $1,500**; Premier support & success at 20% of license (min $3,000/yr).

**Native capabilities**
- Workflow builder: Professional and up ("Complete workflow automation" in Enterprise).
- Sequences/email automation: "Automated, customized emails" (CRM); email marketing automation and journey builder in Marketing.
- Calling: FAQ mentions "click-to-call functions"; plan not specified.
- Forecasting: Not stated on vendor page.
- Quotes/CPQ: Enterprise ("Products, pricebooks, and quotes").
- Marketing automation: Separate product (prices above).
- Mobile app: Yes; plan placement unclear.
- API access: "REST public API"; plan placement unclear.

---

## 11. Copper CRM

**Source:** https://www.copper.com/pricing (fetched OK)

| Plan | Monthly billing | Annual billing | Contacts |
|---|---|---|---|
| Basic | $29/seat/mo | $23/seat/mo | 2,500 |
| Professional | $69 | $59 | 15,000 |
| Business | $134 | $99 | Unlimited |

- USD; taxes and fees excluded; "Up to 26% off" on annual billing.
- Seat minimums/maximums: not stated on vendor page.
- **Trial:** Free trial, no credit card; length not stated. Free plan: not stated on vendor page.

**AI:** "AI email template generator" and "AI email re-writer". Whether included, an add-on or usage-priced, and on which plan: not stated on vendor page.

**Add-ons/onboarding:** Not stated (personal onboarding is described for eligible annual Business/Professional accounts, no fee given).

**Native capabilities**
- Workflow builder: Professional and Business.
- Sequences/email automation: "Email series" (Business); "Email automation" in the compare table.
- Calling: Integrations only (JustCall, RingCentral). Native calling is not stated.
- Forecasting: Not stated on vendor page.
- Quotes: Not stated on vendor page (PandaDoc/DocuSign integrations).
- Marketing automation: Bulk email (Professional and up), email series (Business); not named as marketing automation.
- Mobile app: iOS/Android; plan not stated.
- API access: "API & Embedded integration SDK"; plan not stated.

---

## 12. Nutshell CRM

**Source:** https://www.nutshell.com/pricing (fetched OK)

| Price (per user/mo) | Tier name (inferred from "Everything in X") | Highlights |
|---|---|---|
| $13 | Foundation | 10 AI outcomes; 100 open leads limit (FAQ) |
| $25 | Growth | 20 AI outcomes; sales quotas |
| $42 | Pro | 40 AI outcomes; sales automation |
| $59 | Business | 100 AI outcomes |
| $79 | Top tier (name not shown in the extracted text) | 150 AI outcomes; SSO; SQL data access |

- Currency code: not stated ("$"). The Monthly/Annual toggle shows "Save 15%", with annual savings per tier of $6 / $7 / $7 / $8 / $10. Which basis the headline prices reflect is not clearly stated.
- Seat minimums: not stated.
- **Trial:** 14 days, no credit card. No free plan.

**AI:** AI outcomes included with monthly caps (10 to 150, shared bucket); "AI assists" unlimited. Overage price: not stated.

**Stated add-ons:** Marketing $49/mo; Email marketing from $5/mo (e.g., 1,000 contacts $25/mo); Engagement $16/user/mo; SMS from $15/mo; Nutshell IQ from $37/mo; Proposals & invoices $79/mo. **No setup or implementation fees** (FAQ).

**Native capabilities**
- Workflow builder: "Sales automation" ($42 tier); not named as a workflow builder.
- Sequences: Not stated on vendor page.
- Calling: Not stated on vendor page.
- Forecasting: Only in site navigation ("reports and forecasts"); not tied to a plan.
- Quotes: Via the Proposals & invoices add-on ($79/mo).
- Marketing automation: Via the Marketing add-on ($49/mo); email marketing included in every subscription.
- Mobile app: iOS/Android (free).
- API access: Developer API link; not tied to a plan.

---

## 13. ActiveCampaign — PRICES NOT VERIFIED FROM VENDOR PAGE

**Vendor source:** https://www.activecampaign.com/pricing (fetched OK, but all price fields rendered as placeholders "-/Month"). Plan structure and features below come from the vendor page; prices come from a third party.

**Vendor-stated structure (1,000 contacts, billed yearly):**

| Plan | Email sends/mo | Seats included |
|---|---|---|
| Starter | 10,000 | 1 |
| Plus | 10,000 | 1 |
| Pro | 12,000 | 3 |
| Enterprise | 15,000 | 5 |

- Price is based on contact count. Currencies: USD, BRL, CAD, AUD, EUR, GBP.
- **Trial:** 14-day free trial, no credit card. No free plan.

**Third-party prices (marked):** https://www.emailvendorselection.com/activecampaign-pricing (updated Aug 2026). At 1,000 contacts, USD/mo: Starter $15 yearly / $19; Plus $49 / $59; Pro $79 / $99; Enterprise $145 / $179. The article's own figures do not fully reconcile. It also reports additional users at $12/mo, a Pipelines add-on at $68/mo, and Sales Engagement at $111/mo.

**AI (vendor page):** **Active Intelligence**, included in every plan with **500 AI credits per plan**. More credits can be bought (price not stated). Core AI features keep working after credits run out.

**Add-ons/fees (vendor page):** SMS, WhatsApp, Pipelines (enhanced CRM), Sales Engagement, Transactional Email and Custom Reporting are sold separately (no prices stated). "No setup fees"; "Free migration and onboarding".

**Native capabilities (vendor page)**
- Workflow builder: Yes, all plans (Starter limited to 5 actions per automation; AI automation builder).
- Sequences/email automation: All plans.
- Calling: Not stated on vendor page.
- Forecasting: Not stated on vendor page.
- Quotes: Not stated on vendor page.
- Marketing automation: Yes (core product).
- CRM: Basic CRM on all plans; sales automation on Plus and up; Pipelines is a paid add-on (not on Starter).
- Mobile app: All plans.
- API access: "API & webhooks", all plans.

---

## 14. Keap

**Source:** https://keap.com/pricing (fetched OK)

- **One plan** ("Say goodbye to feature-based plans"): **$299/mo billed monthly** or **$2,988/yr ($249/mo) billed annually**. Currency code not stated ("$"). The meta description says "Starting at $249".
- Includes **2 user licenses**; additional users **$39/month** each. Contact pricing is tiered; tier amounts are not stated on the page without input.
- **Trial:** Free trial, no credit card (25 emails max, no payments, no texts). No free plan.

**AI:** AI Content Assistant and AI Automation Assistant. No separate price is stated.

**Stated add-ons/fees:** Texts: 500 for $6/mo; local number $10/mo; text-marketing tiers $24 / $39 / $79 / $139 / $279 per month; overages $0.015/message and $0.01/voice minute. **Implementation services are described as required, with no price stated.** **Early termination fee $299** on annual contracts. Payment processing fees apply (amount not stated).

**Native capabilities**
- Workflow builder: "Pipeline automation" plus a prebuilt automation library.
- Sequences/email automation: Yes (activity-triggered emails).
- Calling: Business phone line (US/Canada only).
- Forecasting: Not stated on vendor page.
- Quotes: Yes (quotes that convert to invoices).
- Marketing automation: Yes.
- Mobile app: Yes (US, AU, CA, UK, NZ).
- API access: "API & webhooks".

---

## 15. SAP Sales Cloud

**Source:** https://www.sap.com/products/crm/sales-cloud/pricing.html (fetched OK)

| Item | Price | Basis |
|---|---|---|
| SAP Sales Cloud Version 2 (base) | **Price upon request** | Blocks of 1 user; 3 to 36 month terms, auto-renewal |
| Service add-on | USD 22.00 | Per user, monthly |
| Field sales add-on | USD 47.00 | Per user, monthly |
| Dynamic visit planning add-on (test/demo/dev) | EUR 25.00 | Per entitlements package, monthly |
| Test/demo/development tenants | "Configure to see price" | Partner-only, non-productive |

- Yearly prices are pro-rated monthly for terms under a year. Seat minimum: not stated beyond blocks of 1.
- **Trial:** Not stated on vendor page.

**AI:** Joule and AI units are not stated on the vendor page. The add-ons are described as "AI-driven".

**Onboarding fees:** Not stated on vendor page.

**Native capabilities**
- Workflow builder: "Extend and automate… with SAP Build".
- Sequences/email automation: Not stated on vendor page.
- Calling: Not stated on vendor page.
- Forecasting: Not stated on vendor page.
- Quotes/CPQ: Not stated on vendor page.
- Marketing automation: Not stated on vendor page.
- Mobile app: "Smooth mobile selling experience".
- API access: Not stated on vendor page.

---

## Source log (all accessed 2026-10-30)

| Vendor | URL | Status |
|---|---|---|
| Salesforce | https://www.salesforce.com/sales/pricing?bc=HL ; https://salesforce.com/in/sales/pricing | OK (https://www.salesforce.com/sales/pricing/ failed) |
| HubSpot | https://www.hubspot.com/pricing/sales | OK |
| Zoho | https://www.zoho.com/crm/zohocrm-pricing.html ; https://www.zoho.com/crm/comparison.html | OK (prices INR only) |
| Microsoft | https://www.microsoft.com/en-us/dynamics-365/products/sales/pricing | OK |
| Pipedrive | https://www.pipedrive.com/en/pricing | OK |
| monday CRM | https://monday.com/crm/pricing | OK |
| Freshsales | https://www.freshworks.com/crm/pricing/ | OK |
| Creatio | https://www.creatio.com/pricing (and variants) | **FAILED**; used https://creatio.com/landings/creatio-vs-competitors/sales-enterprise-editions-comparison (vendor) and https://www.eesel.ai/blog/creatio-pricing (third-party) |
| Close | https://www.close.com/pricing | OK |
| Insightly | https://www.insightly.com/pricing/ | OK |
| Copper | https://www.copper.com/pricing | OK |
| Nutshell | https://www.nutshell.com/pricing | OK |
| ActiveCampaign | https://www.activecampaign.com/pricing | OK, but **no prices rendered**; prices from https://www.emailvendorselection.com/activecampaign-pricing (third-party) |
| Keap | https://keap.com/pricing | OK |
| SAP | https://www.sap.com/products/crm/sales-cloud/pricing.html | OK |
