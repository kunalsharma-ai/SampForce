# DealFlow Competitive Feature Matrix

**Status:** v1, 2026-10-30. **Evidence:** every competitor price and named capability below comes from
[research/competitor-research-2026-10-30.md](research/competitor-research-2026-10-30.md), which records the
vendor URL and access date for each claim. Prices are list prices shown to a US-based visitor on that date and
change often; re-verify before using them in marketing.

**Rules this document follows**

- No competitor is described as *lacking* a capability. Where a vendor page did not state something, we say
  "not stated on vendor page", which is not the same as "not offered".
- Two vendors could not be verified from their own pricing pages: **Creatio** (page failed to load) and
  **ActiveCampaign** (prices render client-side). Their figures are third-party and marked ⚠.
- Zoho served INR prices only; we do not convert them.

## 1. Published pricing snapshot

| Vendor | Entry paid plan | Top published plan | AI / agent model (as stated) | Fees and limits stated on the vendor page |
|---|---|---|---|---|
| Salesforce Sales Cloud | Starter Suite $25/user/mo | Max $550/user/mo (annual) | Agentforce for Sales add-on from $125/user/mo on Core and Advanced; Max includes Flex Credits | Revenue Intelligence add-on from $220/user/mo; Sales Programs from $100/user/mo |
| HubSpot Sales Hub | Starter "starts at" $7 or $20/seat/mo (term pairing unclear) | Enterprise "starts at" $150/seat/mo | Agents run on HubSpot Credits; 500/3,000/5,000 included; extra $0.010/credit | Required onboarding: $1,500 (Professional), $3,500 (Enterprise) |
| Zoho CRM | Standard ₹800/user/mo (annual) | Ultimate ₹3,200/user/mo (monthly) | Not captured in plan text | Free edition for 3 users |
| Microsoft Dynamics 365 Sales | Sales Professional $65/user/mo (annual) | Sales Premium $150/user/mo | Copilot included; agents need Copilot Credits (Premium includes 1,000/user/mo) | Power Automate / Power Apps features need extra licences |
| Pipedrive | Lite US$14/seat/mo (annual) | Ultimate US$79/seat/mo (annual) | See research file | Monthly prices not stated |
| monday CRM | Basic $12/seat/mo | Pro $28/seat/mo; Ultimate custom | AI credits included in Standard and up; amounts not stated | 3-seat minimum |
| Freshsales | Growth $9/user/mo (annual) | Enterprise $59/user/mo | Freddy AI Agent $49 per 100 sessions | Branded documents $19/user/mo |
| Creatio ⚠ | Growth $40/user/mo platform + $15/user/mo per CRM product | Enterprise $75/user/mo; Unlimited custom | AI credit packs (third-party report) | 5-seat minimum (third-party report) |
| Close | Solo $9 (annual) / $19 (monthly) per user/mo | Scale $139 / $149 | "Chloe" AI agent on all plans with monthly AI credits | Calling/SMS passed through at cost |
| Insightly | Plus $29/user/mo (annual) | Enterprise $99/user/mo | See research file | |
| Copper | Basic $23 (annual) / $29 (monthly) per seat | Business $99 / $134 | See research file | |
| Nutshell | $13/user/mo | $79/user/mo | Nutshell IQ add-on from $37/mo | Many paid add-ons; "no setup or implementation fees" |
| ActiveCampaign ⚠ | Starter $15 (yearly) / $19 (monthly) at 1,000 contacts | Enterprise $145 / $179 at 1,000 contacts | AI credits per plan (vendor page) | Priced by contact count, not per user |
| Keap | One plan $299/mo (2 users), extra users $39/mo | Same | See research file | Implementation described as required (no price); $299 early-termination fee |
| SAP Sales Cloud | Base price on request | Add-ons: field sales $47/user/mo, service $22/user/mo | See research file | 3–36 month terms |

**What this tells us for positioning (no claims about competitor gaps):**

1. AI is now commonly metered (credits, sessions or per-user add-ons). DealFlow should publish its allowance
   and overage price on the pricing page, in the same units it meters.
2. Several vendors state onboarding or implementation charges, minimum seat counts or required add-ons.
   DealFlow's self-service plans state none (see [PRICING_STRATEGY.md](PRICING_STRATEGY.md)).
3. DealFlow's proposed entry price ($8 monthly / $6 annual) sits below most published entry paid plans.
   Freshsales Growth ($9 annual) and Close Solo ($9 annual) are close, so price alone is not the differentiator.

## 2. Capability categories

The categories follow the master brief.

### Category A: must match (table stakes)

These appear on most vendor pricing pages in the research set. Each vendor's "Native capabilities (as stated)"
section in the research file records exactly what its page names; this table does not attribute capabilities
to individual vendors beyond that file.

| Capability | DealFlow phase |
|---|---|
| Contact, company, lead and deal management | 2 |
| Multiple pipelines, Kanban, custom stages | 2 |
| Email integration and templates | 3 |
| Workflow automation builder | 3 |
| Sales sequences | 3 |
| Forecasting | 4 |
| Quotes | 5 |
| Mobile access | 1 (responsive web, **done**); React Native later |
| REST API and webhooks | 2–3 (OpenAPI spec live in Phase 1) |
| Role-based permissions and audit trail | **1 (done)** |
| SSO | **8 (done: OIDC, with SCIM 2.0 provisioning; every plan, including Free).** SAML not built |

### Category B: should improve (same capability, simpler or clearer)

| Area | DealFlow approach |
|---|---|
| Plan complexity and add-on sprawl | One rate card, AI and automation allowances printed per plan, no mandatory onboarding fee on self-service plans |
| Dashboard trust | Every KPI shows its formula in a tooltip; "no data" renders as a dash with the reason, never as a fake zero (**done in Phase 1**) |
| Setup time | Workspace provisioned with roles and a default pipeline at sign-up (**done**); AI-assisted field mapping and import in Phase 2–4 |
| Data quality | Duplicate detection and merge in core CRM (Phase 2), AI Data Quality Agent (Phase 4) |
| Accessibility | WCAG 2.2 AA checks run in CI on every key page, light and dark (**done**) |
| Motion and visual load | User-selectable motion levels (system/full/reduced/off) and low-power mode (**done**) |

### Category C: unify (capabilities usually spread across products or add-ons)

| Combination | Why it matters |
|---|---|
| Sales + marketing journeys + customer success on one data model | One timeline per customer; no sync jobs between hubs |
| Automation Studio + AI agents + approvals in one engine | Agents are just permissioned workflow actors with the same logs, retries and kill switches |
| Revenue intelligence built on the audit/event stream | Forecast snapshots and the Revenue Time Machine replay the same events the audit log records |
| Communication hub (email, calendar, meetings, chat) attached to records | Native timeline, clearly labelling which channels are third-party integrations |

### Category D: differentiating innovations

| Concept | Description | Phase |
|---|---|---|
| Command Center | Live, explainable KPIs, pipeline health, approvals and next-best actions | 1 (foundation done), 4 (AI) |
| Copilot with approval tiers | Natural language → typed tool calls; read-only runs immediately, sensitive actions queue for approval | 4 |
| Revenue Brain | Explainable recommendations showing the signals and records behind each one | 4–5 |
| Digital Sales Team | 12 agents with tool allowlists, cost caps, audit trails and kill switches | 4 |
| AI workflow builder | Prompt → editable visual workflow, simulated before activation | 4 |
| Revenue Time Machine | Compare historical pipeline snapshots with clearly labelled scenario projections | 5 |
| Relationship Galaxy | 3D account network with accessible graph and table alternatives | 7 (✅ shipped) |
| Transparent AI metering | Per-tenant AI usage, cost and allowance visible to admins in real time | 4 |

### Category E: needs licensing, infrastructure, third-party APIs or legal review

| Item | Dependency | Review needed |
|---|---|---|
| Gmail / Google Calendar sync | Google OAuth app; restricted-scope verification and security assessment | Google API Services User Data Policy |
| Microsoft 365 / Teams | Entra ID app registration, admin consent | Microsoft publisher verification |
| WhatsApp Business Platform | Meta Business verification, approved templates | Messaging policy, opt-in records |
| SMS / telephony (Twilio etc.) | Carrier registration (e.g., US A2P 10DLC) | TCPA, regional consent rules |
| Call / meeting recording and transcription | Speech-to-text provider | Recording-consent laws vary by jurisdiction |
| AI providers (Anthropic, OpenAI, Google) | API keys, DPAs, data-retention settings | Subprocessor disclosure, DPA review |
| E-signature (DocuSign etc.) | Developer account and production review | eIDAS / ESIGN applicability |
| Payments (Stripe, Razorpay, PayPal) | Merchant accounts, webhooks | PCI scope (DealFlow never stores card data), RBI rules for India |
| Data enrichment / sales research agent | Licensed data sources only | Website terms, GDPR/DPDP lawful basis |
| Email sending at scale | Dedicated sending domain, SPF/DKIM/DMARC, provider account | CAN-SPAM, GDPR, CASL |

## 3. Re-verification checklist

Before any public comparison page: re-fetch every vendor page in the research file, resolve the items marked
"plan placement unclear" by reading the live comparison tables, get USD Zoho pricing, verify Creatio and
ActiveCampaign on their own pages, and have legal review comparative claims.
