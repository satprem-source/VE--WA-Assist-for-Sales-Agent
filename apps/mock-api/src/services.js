/**
 * Services the bots depend on. This is the seam for production:
 * replace the store calls with DB/insurer API calls, and replace
 * `deliver()` with a WhatsApp Cloud API sender.
 */
import { generateIllustration, advanceStage, toCloudApiPayload, stageLabel, documentMessage, getDocType } from '@nb/shared';
import { db, now, nextId } from './store.js';

const H = 3600 * 1000;
const clients = new Set();

export function addSseClient(res) { clients.add(res); res.on('close', () => clients.delete(res)); }
export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(payload);
}

const touch = (lead, { customer = false } = {}) => {
  const ts = now().toISOString();
  lead.updatedAt = ts;
  lead.lastActivityAt = ts;
  if (customer) lead.lastCustomerInboundAt = ts;
};

function emitLead(lead) { broadcast('lead', lead); }

/** Record a message on a conversation and push it to connected UIs. */
export function deliver(key, msg, { dir = 'out', to } = {}) {
  const record = { id: nextId.msg(), dir, ts: now().toISOString(), ...msg, meta: { ...(msg.meta || {}) } };

  if (dir === 'out' && key.startsWith('customer:')) {
    const lead = db.leads[key.split(':')[1]];
    const last = lead?.lastCustomerInboundAt ? new Date(lead.lastCustomerInboundAt).getTime() : 0;
    const windowOpen = now().getTime() - last < 24 * H;
    record.meta.sessionWindow = windowOpen ? 'open' : 'closed';
    if (!windowOpen && !record.meta.template) {
      // Outside the 24h customer-service window only approved templates can be sent.
      record.meta.template = 'nb_generic_update';
      record.meta.sentAsTemplate = true;
    }
    to = lead ? `91${lead.mobile}` : to;
  }
  if (dir === 'out') {
    record.meta.cloudApiPreview = record.meta.template && record.type !== 'buttons'
      ? toCloudApiPayload({ type: 'template', template: { name: record.meta.template, params: [String(record.text || '').slice(0, 60)] } }, to)
      : toCloudApiPayload(record, to);
  }
  (db.conversations[key] ||= []).push(record);
  broadcast('message', { key, message: record });
  return record;
}

export const services = {
  now,

  async getAgent(id) { return db.agents[id]; },
  async getLead(id) { return db.leads[id] || null; },
  async listLeads(agentId) {
    return Object.values(db.leads).filter((l) => !agentId || l.agentId === agentId)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  },

  async createLead(data) {
    const id = nextId.lead();
    const ts = now().toISOString();
    const lead = {
      id, agentId: data.agentId || 'agent-1', name: data.name, mobile: data.mobile, source: data.source || 'Walk-in', note: data.note || '',
      stage: 'new', consent: { given: false }, profile: null, goals: [], risk: null, needs: null, recommendedProductIds: [],
      comparisons: [], illustrationIds: [], lostReason: null, createdAt: ts, updatedAt: ts, lastActivityAt: ts,
      timeline: [{ ts, type: 'created', text: `Lead created (${data.source || 'Walk-in'})` }],
    };
    db.leads[id] = lead;
    emitLead(lead);
    return lead;
  },

  async updateLead(id, patch) {
    const lead = db.leads[id];
    Object.assign(lead, patch);
    touch(lead);
    emitLead(lead);
    return lead;
  },

  async logEvent(leadId, type, textLine) {
    const lead = db.leads[leadId];
    if (!lead) return;
    lead.timeline.push({ ts: now().toISOString(), type, text: textLine });
    emitLead(lead);
  },

  async setStage(leadId, stage, { manual = false, reason } = {}) {
    const lead = db.leads[leadId];
    const next = manual ? stage : advanceStage(lead.stage, stage);
    if (next !== lead.stage) {
      const from = lead.stage;
      lead.stage = next;
      lead.timeline.push({ ts: now().toISOString(), type: 'stage', text: `${stageLabel(from)} → ${stageLabel(next)}${reason ? ` (${reason})` : ''}` });
    }
    touch(lead);
    emitLead(lead);
    return lead;
  },

  async recordNeeds(leadId, { goals, risk, needs, by }) {
    const lead = db.leads[leadId];
    Object.assign(lead, { goals, risk, needs, recommendedProductIds: needs.recommendedProductIds });
    lead.timeline.push({ ts: now().toISOString(), type: 'needs', text: `Need analysis completed by ${by}` });
    await services.setStage(leadId, 'needs_done');
  },

  async recordComparison(leadId, { a, b, by }) {
    const lead = db.leads[leadId];
    lead.comparisons.push({ ts: now().toISOString(), a: a.id, b: b.id, by });
    lead.timeline.push({ ts: now().toISOString(), type: 'comparison', text: `Compared ${a.id.toUpperCase()} vs ${b.id.toUpperCase()} (${by})` });
    await services.setStage(leadId, 'quote_shared');
  },

  async createIllustration(leadId, productId, inputs, { by, shared }) {
    const lead = db.leads[leadId];
    const profile = lead.profile || {};
    const bi = generateIllustration(productId, { age: profile.age, gender: profile.gender, tobacco: profile.tobacco, ...inputs }, { id: nextId.bi(), now: now() });
    const record = { ...bi, leadId, createdBy: by, sharedAt: shared ? now().toISOString() : null, acknowledgedAt: null };
    db.illustrations[bi.illustrationId] = record;
    lead.illustrationIds.push(bi.illustrationId);
    lead.timeline.push({ ts: now().toISOString(), type: 'illustration', text: `Illustration ${bi.illustrationId} (${bi.productName}) created by ${by}${shared ? ' and shared' : ''}` });
    if (shared) await services.setStage(leadId, 'bi_shared'); else { touch(lead); emitLead(lead); }
    return record;
  },

  async getIllustration(id) { return db.illustrations[id] || null; },
  async listIllustrations(leadId, { sharedOnly = false } = {}) {
    return (db.leads[leadId]?.illustrationIds || []).map((i) => db.illustrations[i]).filter((b) => b && (!sharedOnly || b.sharedAt));
  },

  async shareIllustration(id, by) {
    const bi = db.illustrations[id];
    bi.sharedAt = now().toISOString();
    deliver(`customer:${bi.leadId}`, documentMessage(bi));
    deliver(`customer:${bi.leadId}`, {
      type: 'buttons',
      text: 'Your advisor shared this illustration. Tap below once you have gone through it.',
      buttons: [{ id: `ack:${id}`, title: "I've reviewed it" }, { id: 'menu:advisor', title: 'Talk to advisor' }, { id: 'menu', title: 'Menu' }],
    });
    await services.logEvent(bi.leadId, 'illustration', `Illustration ${id} (${bi.productName}) shared by ${by}`);
    await services.setStage(bi.leadId, 'bi_shared');
    return bi;
  },

  async acknowledgeIllustration(id, by) {
    const bi = db.illustrations[id];
    bi.acknowledgedAt = now().toISOString();
    await services.logEvent(bi.leadId, 'illustration', `Illustration ${id} reviewed by ${by} (acknowledgement, not a signature)`);
    return bi;
  },

  /** Application documents. Bytes live in db.media; the record only points at them. */
  async listDocuments(leadId) {
    return Object.values(db.documents).filter((d) => d.leadId === leadId).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  },

  async attachDocument(leadId, typeId, inbound) {
    const lead = db.leads[leadId];
    const type = getDocType(typeId);
    for (const d of Object.values(db.documents)) if (d.leadId === leadId && d.type === typeId && d.status !== 'superseded') d.status = 'superseded';
    const doc = {
      id: nextId.doc(), leadId, type: typeId, status: 'received', mediaId: inbound.mediaId, url: inbound.url || null,
      mime: inbound.mime, filename: inbound.filename || null, size: inbound.size || null, caption: inbound.caption || '',
      uploadedAt: now().toISOString(), reviewedAt: null, reviewedBy: null, reason: null,
    };
    db.documents[doc.id] = doc;
    lead.awaitingDoc = null;
    lead.timeline.push({ ts: doc.uploadedAt, type: 'document', text: `${type.label} received (${doc.id})` });
    touch(lead);
    emitLead(lead);
    return doc;
  },

  async reviewDocument(id, status, { reason, by = 'agent' } = {}) {
    const doc = db.documents[id];
    const lead = db.leads[doc.leadId];
    const type = getDocType(doc.type);
    Object.assign(doc, { status, reason: status === 'rejected' ? reason || 'Not clear enough' : null, reviewedAt: now().toISOString(), reviewedBy: by });
    lead.timeline.push({ ts: doc.reviewedAt, type: 'document', text: `${type.label} ${status} by ${by}${doc.reason ? `: ${doc.reason}` : ''}` });
    if (status === 'rejected' && lead.consent?.given) {
      deliver(`customer:${lead.id}`, {
        type: 'buttons', text: `Your advisor could not accept your *${type.label}*: ${doc.reason}.\n\nPlease send it again.`,
        buttons: [{ id: `docs:ask:${doc.type}`, title: 'Send again' }, { id: 'menu', title: 'Menu' }],
      });
    }
    touch(lead);
    emitLead(lead);
    return doc;
  },

  /** Speech-to-text seam. The simulator sends the transcript with the voice note; production calls an STT service here. */
  async transcribe(inbound) { return inbound.transcript || null; },

  async sendToCustomer(leadId, msg) { return deliver(`customer:${leadId}`, msg); },
  async sendToAgent(agentId, msg) { return deliver(`agent:${agentId}`, msg); },

  async notifyAgent(lead, line, leadId = lead.id) {
    return deliver(`agent:${lead.agentId}`, {
      type: 'buttons', text: `🔔 ${line}`,
      buttons: [{ id: `a:lead:${leadId}`, title: 'Open lead' }, { id: 'a:menu', title: 'Menu' }],
      meta: { notification: true },
    });
  },

  async setActiveLead(agentId, leadId) { db.convState[`agent:${agentId}`] = { activeLeadId: leadId }; },
  touchCustomer(leadId) { const l = db.leads[leadId]; if (l) { touch(l, { customer: true }); emitLead(l); } },
};
