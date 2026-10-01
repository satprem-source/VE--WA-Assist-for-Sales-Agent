# CLAUDE.md — working on this repo

Read this first. It tells Claude Code how the prototype is put together, the rules that must not be broken, and what to build next.

## Commands

- `npm install` then `npm run dev` (API :4000 + web :5173, Vite proxies `/api`)
- `npm test` runs `node --test` over `packages/shared/test` and `apps/mock-api/test`
- `npm run build` builds the web app

## Architecture in one paragraph

Both phones in the UI post an **inbound** (`text | button_reply | list_reply | flow_submit`) to `POST /api/conversations/:key/inbound`, where the key is `customer:<leadId>` or `agent:<agentId>`. The server records it and calls `handleCustomerInbound` or `handleAgentInbound` from `packages/shared/src/bots`. Bots are nearly stateless: they route on reply ids such as `prod:fgp`, `cmpB:fgp:grip`, `a:share_bi:BI-00003`, and they read and write through a `services` object (`apps/mock-api/src/services.js`). They return internal messages (`text | buttons | list | flow | document`), which `deliver()` stores, tags with session-window info and a Cloud API preview, and broadcasts over SSE (`/api/stream`). The dashboard re-fetches on `lead` events.

## Non-negotiable rules

1. **UINs are exact.** Never substitute a nearest version. A product change means a deliberate edit to `packages/shared/src/products.js` and the catalogue test.
2. **Indicative values stay labelled.** Every illustration carries `watermark`, `disclaimer` and `source: 'indicative-placeholder'`. Don't remove them until `source` is `insurer-quote-api`.
3. **Market-linked plans carry the 4%/8% note**, and ULIP copy says the investment risk is borne by the policyholder.
4. **Consent before processing.** The customer bot refuses to process anything until `lead.consent.given`. STOP opts out at any point.
5. **Acknowledgement is not a signature.** "I've reviewed it" is logged as an acknowledgement. The signed BI still goes with the proposal.
6. **WhatsApp limits.** At most 3 buttons (title ≤ 20 characters), at most 10 list rows, body ≤ 1024 characters. `toCloudApiPayload` clips, but design copy to fit.
7. **Outside 24h, templates only.** `deliver()` marks such messages. In production they must map to approved templates.

## Conventions

- Plain ESM JavaScript with JSDoc. No build step for `shared` or `mock-api`. Converting to TypeScript is backlog item 9.
- Chat copy: sentence case, plain verbs, WhatsApp formatting (`*bold*`, `_italic_`). Figures via `inr()`.
- New bot actions: add a reply-id prefix, handle it in the bot, add a journey test.
- Tune need-analysis assumptions in `NEED_ASSUMPTIONS` and stale rules in `STALE_RULES`, not inline.

## Replacing the mock layer (production path)

| Mock | Replace with |
|---|---|
| `generateIllustration()` | Insurer quote/BI API adapter per insurer, keeping the output shape in `openapi.yaml#/components/schemas/Illustration`. The ValuEnable CE illustration tools are policy-number based (in-force), so they don't cover new business |
| `store.js` in-memory `db` | Postgres (leads, events, illustrations, conversations, consent log) |
| `deliver()` | WhatsApp Cloud API sender (`POST /{phone-number-id}/messages`) using `meta.cloudApiPreview` as the body; store `wamid` and status webhooks |
| `/webhook/whatsapp` | Already parses Cloud API messages. Add signature verification (`X-Hub-Signature-256`) and idempotency on `wamid` |
| WhatsApp Flows (`type: 'flow'`) | Build the Flow JSON in Meta's Flow Builder for `need_profile`, `need_goals`, `bi_inputs:*`, `a_new_lead`; the field lists in `bots/messages.js` and `inputFields()` are the spec |
| PDF renderer | Insurer-issued BI PDF (store and forward), or a filed template |
| Single demo agent | Auth (agent mobile + OTP), multi-agent, hierarchy views |

## Backlog (suggested order)

1. Insurer quote API adapter interface and one real integration; remove placeholder formulas behind a flag.
2. Persistence (Postgres + Prisma or Drizzle) and a migration for the current lead model.
3. Real Cloud API sender, status tracking (sent, delivered, read) shown as ticks in the UI.
4. Flow JSON definitions and the Flow data-exchange endpoint.
5. Proposal handoff: deep link to the insurer's proposal journey with prefilled data; lead → *issued* via insurer callback.
6. Agent auth, multi-agent and a manager dashboard (funnel conversion, time-in-stage, stale aging).
7. Consent ledger (purpose, timestamp, channel, withdrawal) exportable for audit (DPDP).
8. Second insurer in the catalogue; product comparison across insurers.
9. TypeScript migration of `shared` (types already sketched in JSDoc).
10. Hindi and regional languages (templates need separate approval per language).

## Documents and voice notes (added)

- **Documents.** `packages/shared/src/documents.js` defines the types (`DOC_TYPES`: PAN card and photo required; address and bank proof optional), upload validation (JPG/PNG/PDF, 5 MB) and the checklist. The bot flow is `menu:docs` → `docs:ask:<type>` → file → `docs:tag:<type>` when the type can't be guessed from the caption. Re-uploading supersedes the older file; the advisor accepts or rejects from the dashboard and a rejection asks the customer to resend.
- **Voice notes.** Inbound `{type:'audio', transcript}` goes through `interpretVoice()` (`voice.js`, rule-based) and is routed like a tap, so consent and STOP rules still apply. A spoken profile ("I'm 41, earn 36 lakh, three kids") only *prefills* the needs form; nothing is saved until the customer submits. Voice opt-out asks for confirmation (`optout:confirm`).
- **Seams to replace in production:** `services.transcribe(inbound)` (speech-to-text; Indian languages need a provider that supports them), and media download for the Cloud API webhook (`waMediaId` → `GET /{media-id}` → bearer-authenticated fetch → object storage). The mock keeps bytes in memory (`db.media`).
- **Rules for documents:** treat PAN, photos and voice as personal data. In production: encrypted object storage, malware scan, retention and deletion policy, access logging, and the customer's consent purpose must cover documents. Don't collect unmasked Aadhaar over WhatsApp.
