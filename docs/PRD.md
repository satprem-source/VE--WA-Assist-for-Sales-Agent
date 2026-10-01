# PRD — New business on WhatsApp (v1 prototype)

## Problem

Advisors and bank relationship managers sell life insurance mostly over WhatsApp already, but informally. Needs are guessed, comparisons are screenshots, illustrations are forwarded PDFs with no audit trail, and leads go quiet without anyone noticing. Customers get inconsistent advice and managers get no pipeline visibility.

## Goal

A WhatsApp-native new-business layer that an insurer, bank or broker can run on its own business number: structured need analysis, like-for-like comparison, illustration sharing with acknowledgement, and a lead pipeline that updates itself from the conversation.

## Users

- **Customer:** chats with the business number, self-serve or prompted by their advisor.
- **Agent/advisor:** chats with a separate "Sales Assist" number to run the same journeys on the customer's behalf and manage leads.
- **Sales manager (later):** reads the dashboard.

## Scope (v1)

| Module | Customer | Agent |
|---|---|---|
| Opt-in | Consent template with Yes/Not now; STOP/START | Triggered automatically before any outbound |
| Need analysis | Two WhatsApp Flows (profile, goals + risk) → gaps + plans | Push the form to the customer, or fill it and share the summary |
| Comparison | Pick two plans → side-by-side (premium, cover, benefit, IRR) | Same, then send to customer |
| Illustration | Set inputs in a Flow → watermarked PDF → acknowledge → apply | Create, check, share; notified on review |
| Lead tracking | — | Add lead, list, follow-ups due, stage updates, lost reasons; dashboard with timeline |

Catalogue: 9 Tata AIA plans with online-purchase links on tataaia.com (2026-09-30), exact UINs. Out of scope by decision: Shubh Shakti Select, standalone riders, Hindi, real quotes.

## Business rules

- **Need analysis.** Protection = HLV (70% of income, 6% growth, 8% discount, to retirement age) + loans − existing cover. Education = today's cost × 10% inflation to age 18. Retirement = inflation-linked expenses from retirement to 85 at 7% post-retirement return. Health = max(₹10L, ₹5L × members). Protection is surfaced automatically when there are dependents and a gap.
- **Product mapping.** Low risk → guaranteed plans only. Wealth/education at moderate or high risk → ULIP solutions. Retirement: ULIP pension if 10+ years and risk above low, otherwise annuity.
- **Stages.** New → Needs analysed → Plans compared → Illustration shared → Proposal started → Issued / Lost. The system only moves stages forward; agents can move them anywhere.
- **Stale flags.** New 24h, Needs analysed 72h, Plans compared 48h, Illustration shared 48h, Proposal 72h without activity.
- **Session window.** Business messages more than 24h after the customer's last message must be approved templates.

## Compliance notes

- Illustrations are watermarked "Illustrative – not a Tata AIA quote" with a disclaimer. ULIP and participating plans carry the 4%/8% assumed-rate note.
- The customer's review tap is an acknowledgement, not the signed BI required with the proposal.
- Purpose-specific consent is captured before any personal data is processed, and withdrawal (STOP) is honoured immediately.
- Every action is logged on the lead timeline for audit.

## Acceptance criteria (demo)

1. An agent can add a lead and get the customer to a shared illustration without leaving WhatsApp.
2. A customer can complete needs → compare → illustration → apply unaided.
3. The dashboard reflects every step within a second, with no refresh.
4. Advancing the clock shows follow-up flags and template-only sending.
5. Every bot message exposes a valid Cloud API payload.

## Success metrics (pilot)

Opt-in rate, needs-completion rate, time from lead to illustration shared, illustration → proposal conversion, share of leads flagged stale, and agent actions per lead.
