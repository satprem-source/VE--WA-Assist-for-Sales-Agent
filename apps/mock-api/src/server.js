/**
 * Mock API for the WhatsApp new-business prototype.
 * Contract: docs/openapi.yaml. Run: npm run dev:api (port 4000).
 */
import express from 'express';
import cors from 'cors';
import {
  PRODUCTS, COMPONENT_PRODUCTS, CATALOGUE_SOURCE, getProduct, analyseNeeds, generateIllustration, comparison,
  handleCustomerInbound, handleAgentInbound, staleness, STAGES, fromCloudApiWebhook, inputFields, defaultInputs,
} from '@nb/shared';
import { db, seed, now, advanceClock, clockOffsetHours, nextId } from './store.js';
import { services, deliver, addSseClient, broadcast } from './services.js';
import { renderIllustrationPdf } from './pdf.js';

const PORT = process.env.PORT || 4000;
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'dev-verify-token';

seed();
const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' })); // media arrives as base64 data URLs in the simulator

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const withStale = (lead) => ({ ...lead, stale: staleness(lead, now().getTime()) });

/* ---------- Meta ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true, now: now().toISOString(), clockOffsetHours: clockOffsetHours() }));
app.get('/api/agents/:id', (req, res) => (db.agents[req.params.id] ? res.json(db.agents[req.params.id]) : res.status(404).json({ error: 'Agent not found' })));
app.get('/api/stages', (req, res) => res.json(STAGES));

/* ---------- Products ---------- */
app.get('/api/products', (req, res) => res.json({ source: CATALOGUE_SOURCE, products: PRODUCTS, components: COMPONENT_PRODUCTS }));
app.get('/api/products/:id', (req, res) => {
  const p = getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json({ ...p, inputFields: inputFields(p), defaultInputs: defaultInputs(p, req.query) });
});

/* ---------- Leads ---------- */
app.get('/api/leads', wrap(async (req, res) => res.json((await services.listLeads(req.query.agentId)).map(withStale))));
app.post('/api/leads', wrap(async (req, res) => {
  const { name, mobile } = req.body || {};
  if (!name || !/^\d{10}$/.test(String(mobile || ''))) return res.status(400).json({ error: 'name and a 10-digit mobile are required' });
  res.status(201).json(withStale(await services.createLead(req.body)));
}));
app.get('/api/leads/:id', (req, res) => {
  const lead = db.leads[req.params.id];
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json({
    ...withStale(lead),
    illustrations: lead.illustrationIds.map((i) => summariseBi(db.illustrations[i])),
    documents: Object.values(db.documents).filter((d) => d.leadId === lead.id).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)),
  });
});
app.patch('/api/leads/:id', wrap(async (req, res) => {
  const lead = db.leads[req.params.id];
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const { stage, lostReason, note } = req.body || {};
  if (stage) await services.setStage(lead.id, stage, { manual: true, reason: stage === 'lost' ? lostReason : 'Updated from dashboard' });
  if (lostReason !== undefined) await services.updateLead(lead.id, { lostReason });
  if (note) await services.logEvent(lead.id, 'note', note);
  res.json(withStale(db.leads[lead.id]));
}));

/* ---------- Conversations ---------- */
app.get('/api/conversations/:key', (req, res) => res.json(db.conversations[req.params.key] || []));

/**
 * Inbound message from the simulated phone.
 * key = customer:<leadId> | agent:<agentId>
 * body = { inbound: { type, text?, id?, title?, flowId?, data? } }
 */
app.post('/api/conversations/:key/inbound', wrap(async (req, res) => {
  const { key } = req.params;
  let inbound = req.body?.inbound;
  if (!inbound?.type) return res.status(400).json({ error: 'inbound.type is required' });
  const [kind, ref] = key.split(':');
  if (kind === 'customer' && !db.leads[ref]) return res.status(404).json({ error: 'Lead not found' });
  if (kind === 'agent' && !db.agents[ref]) return res.status(404).json({ error: 'Agent not found' });
  if (inbound.dataUrl) {
    if (kind !== 'customer' || !['image', 'document', 'audio'].includes(inbound.type)) return res.status(400).json({ error: 'Only customers can send media' });
    inbound = ingestMedia(inbound, ref);
  }

  deliver(key, { type: 'reply', inbound, text: describeInbound(inbound) }, { dir: 'in' });
  if (kind === 'customer') services.touchCustomer(ref);

  const replies = kind === 'customer' ? await handleCustomerInbound(ref, inbound, services) : await handleAgentInbound(ref, inbound, services);
  const sent = replies.map((m) => deliver(key, m));
  res.json({ messages: sent });
}));

function describeInbound(i) {
  if (i.type === 'text') return i.text;
  if (i.type === 'button_reply' || i.type === 'list_reply') return i.title;
  if (i.type === 'flow_submit') return 'Form submitted';
  if (i.type === 'audio') return `🎙️ Voice note${i.durationSec ? ` ${Math.round(i.durationSec)}s` : ''}`;
  if (i.type === 'image') return i.caption || '📷 Photo';
  if (i.type === 'document') return i.caption || `📄 ${i.filename || 'Document'}`;
  return '';
}

/** Move the base64 payload into the media store so messages and SSE events stay small. */
function ingestMedia(inbound, leadId) {
  const m = /^data:([^;,]+)[^,]*;base64,(.*)$/s.exec(inbound.dataUrl);
  if (!m) throw Object.assign(new Error('Invalid media payload'), { status: 400 });
  const bytes = Buffer.from(m[2], 'base64');
  const { dataUrl, ...rest } = inbound;
  const mediaId = nextId.media();
  db.media[mediaId] = { id: mediaId, leadId, mime: m[1], bytes, filename: rest.filename || null };
  return { ...rest, mediaId, mime: m[1], size: bytes.length, url: `/api/media/${mediaId}` };
}

/* ---------- Media and application documents ---------- */
app.get('/api/media/:id', (req, res) => {
  const m = db.media[req.params.id];
  if (!m) return res.status(404).json({ error: 'Media not found' });
  res.setHeader('Content-Type', m.mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(m.bytes);
});
app.get('/api/leads/:id/documents', wrap(async (req, res) => {
  if (!db.leads[req.params.id]) return res.status(404).json({ error: 'Lead not found' });
  res.json(await services.listDocuments(req.params.id));
}));
app.patch('/api/documents/:id', wrap(async (req, res) => {
  if (!db.documents[req.params.id]) return res.status(404).json({ error: 'Document not found' });
  const { status, reason } = req.body || {};
  if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be accepted or rejected' });
  res.json(await services.reviewDocument(req.params.id, status, { reason, by: 'agent' }));
}));

/* ---------- Needs & comparison (stateless helpers) ---------- */
app.post('/api/needs/analyse', (req, res) => {
  const { profile, goals = [], risk = 'moderate' } = req.body || {};
  res.json(analyseNeeds(profile || {}, goals, risk));
});
app.post('/api/compare', (req, res) => {
  const { a, b, profile } = req.body || {};
  if (!getProduct(a) || !getProduct(b)) return res.status(400).json({ error: 'a and b must be valid product ids or UINs' });
  res.json(comparison(getProduct(a).id, getProduct(b).id, profile || {}));
});

/* ---------- Illustrations ---------- */
const summariseBi = (b) => b && ({
  illustrationId: b.illustrationId, productId: b.productId, productName: b.productName, uin: b.uin,
  premium: b.premium, createdBy: b.createdBy, generatedAt: b.generatedAt, sharedAt: b.sharedAt, acknowledgedAt: b.acknowledgedAt,
});

app.post('/api/illustrations', wrap(async (req, res) => {
  const { leadId, productId, inputs = {}, share = false } = req.body || {};
  if (leadId) {
    if (!db.leads[leadId]) return res.status(404).json({ error: 'Lead not found' });
    const bi = await services.createIllustration(leadId, productId, inputs, { by: 'api', shared: false });
    if (share) await services.shareIllustration(bi.illustrationId, 'api');
    return res.status(201).json(db.illustrations[bi.illustrationId]);
  }
  res.status(201).json(generateIllustration(productId, inputs, { now: now() })); // stateless preview
}));
app.get('/api/illustrations/:id.pdf', (req, res) => {
  const bi = db.illustrations[req.params.id];
  if (!bi) return res.status(404).json({ error: 'Illustration not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${bi.illustrationId}_${bi.productId}.pdf"`);
  renderIllustrationPdf(bi, db.leads[bi.leadId], res);
});
app.get('/api/illustrations/:id', (req, res) => (db.illustrations[req.params.id] ? res.json(db.illustrations[req.params.id]) : res.status(404).json({ error: 'Illustration not found' })));
app.post('/api/illustrations/:id/share', wrap(async (req, res) => {
  const bi = db.illustrations[req.params.id];
  if (!bi) return res.status(404).json({ error: 'Illustration not found' });
  if (!db.leads[bi.leadId].consent?.given) return res.status(409).json({ error: 'Customer has not opted in' });
  res.json(summariseBi(await services.shareIllustration(bi.illustrationId, req.body?.by || 'agent')));
}));
app.post('/api/illustrations/:id/ack', wrap(async (req, res) => {
  if (!db.illustrations[req.params.id]) return res.status(404).json({ error: 'Illustration not found' });
  res.json(summariseBi(await services.acknowledgeIllustration(req.params.id, req.body?.by || 'customer')));
}));

/* ---------- Realtime ---------- */
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({ now: now().toISOString() })}\n\n`);
  addSseClient(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => clearInterval(ping));
});

/* ---------- Demo controls ---------- */
app.post('/api/demo/clock', (req, res) => {
  const t = advanceClock(Number(req.body?.hours || 0));
  broadcast('clock', { now: t.toISOString(), clockOffsetHours: clockOffsetHours() });
  res.json({ now: t.toISOString(), clockOffsetHours: clockOffsetHours() });
});
app.post('/api/demo/reset', (req, res) => {
  seed();
  broadcast('reset', { now: now().toISOString() });
  res.json({ ok: true });
});

/* ---------- WhatsApp Cloud API webhook (shape only) ----------
 * Lets you point a real Cloud API test number here later. Customer messages
 * are matched to leads by mobile number; the agent number is agent-1's mobile.
 */
app.get('/webhook/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/webhook/whatsapp', wrap(async (req, res) => {
  const changes = req.body?.entry?.flatMap((e) => e.changes || []) || [];
  for (const ch of changes) {
    for (const m of ch.value?.messages || []) {
      const mobile = String(m.from || '').slice(-10);
      const inbound = fromCloudApiWebhook(m);
      const agent = Object.values(db.agents).find((a) => a.mobile === mobile);
      if (agent) {
        deliver(`agent:${agent.id}`, { type: 'reply', inbound, text: describeInbound(inbound) }, { dir: 'in' });
        (await handleAgentInbound(agent.id, inbound, services)).forEach((r) => deliver(`agent:${agent.id}`, r));
        continue;
      }
      const lead = Object.values(db.leads).find((l) => l.mobile === mobile);
      if (!lead) continue; // production: create an inbound lead
      deliver(`customer:${lead.id}`, { type: 'reply', inbound, text: describeInbound(inbound) }, { dir: 'in' });
      services.touchCustomer(lead.id);
      (await handleCustomerInbound(lead.id, inbound, services)).forEach((r) => deliver(`customer:${lead.id}`, r));
    }
  }
  res.sendStatus(200);
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => console.log(`Mock API on http://localhost:${PORT}`));
