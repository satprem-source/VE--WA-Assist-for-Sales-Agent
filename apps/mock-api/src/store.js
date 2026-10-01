/**
 * In-memory store + demo clock. Swap for a database in production
 * (see docs/CLAUDE.md → "Replacing the mock layer").
 */
import { analyseNeeds, generateIllustration } from '@nb/shared';

const H = 3600 * 1000;
let clockOffsetMs = 0;
export const now = () => new Date(Date.now() + clockOffsetMs);
export const advanceClock = (hours) => { clockOffsetMs += hours * H; return now(); };
export const clockOffsetHours = () => Math.round(clockOffsetMs / H);

export const db = { agents: {}, leads: {}, illustrations: {}, conversations: {}, convState: {}, documents: {}, media: {}, seq: { lead: 1000, msg: 0, bi: 0, doc: 0, media: 0 } };

export const nextId = {
  lead: () => `L-${++db.seq.lead}`,
  msg: () => `m${++db.seq.msg}`,
  bi: () => `BI-${String(++db.seq.bi).padStart(5, '0')}`,
  doc: () => `D-${String(++db.seq.doc).padStart(4, '0')}`,
  media: () => `M-${String(++db.seq.media).padStart(4, '0')}`,
};

const ago = (h) => new Date(now().getTime() - h * H).toISOString();

function pushMsg(key, m) {
  (db.conversations[key] ||= []).push({ id: nextId.msg(), ...m });
}

export function seed() {
  clockOffsetMs = 0;
  db.agents = {}; db.leads = {}; db.illustrations = {}; db.conversations = {}; db.convState = {}; db.documents = {}; db.media = {};
  db.seq = { lead: 1000, msg: 0, bi: 0, doc: 0, media: 0 };

  db.agents['agent-1'] = { id: 'agent-1', name: 'Priya Nair', mobile: '9800000001', channel: 'Agency' };

  const mk = (o) => {
    const id = nextId.lead();
    db.leads[id] = {
      id, agentId: 'agent-1', source: 'Referral', stage: 'new', consent: { given: false },
      profile: null, goals: [], risk: null, needs: null, recommendedProductIds: [], comparisons: [],
      illustrationIds: [], timeline: [], lostReason: null, ...o,
    };
    db.leads[id].timeline.unshift({ ts: o.createdAt, type: 'created', text: `Lead created (${db.leads[id].source})` });
    return db.leads[id];
  };

  // 1. Fresh lead, nothing sent yet
  mk({ name: 'Rahul Mehta', mobile: '9820011111', source: 'Walk-in', createdAt: ago(2), updatedAt: ago(2), lastActivityAt: ago(2) });

  // 2. Needs analysed 80h ago, no plan shared → stale
  const p2 = { age: 34, gender: 'female', maritalStatus: 'married', dependents: 2, youngestChildAge: 4, annualIncome: 2400000, monthlyExpenses: 90000, liabilities: 5500000, existingCover: 5000000, retirementAge: 58 };
  const n2 = analyseNeeds(p2, ['protection', 'child_education', 'retirement'], 'moderate');
  n2.generatedAt = ago(80);
  const l2 = mk({
    name: 'Anjali Rao', mobile: '9820022222', source: 'Existing customer', createdAt: ago(96), updatedAt: ago(80), lastActivityAt: ago(80),
    stage: 'needs_done', consent: { given: true, at: ago(95), channel: 'whatsapp' },
    profile: p2, goals: n2.goals, risk: 'moderate', needs: n2, recommendedProductIds: n2.recommendedProductIds,
  });
  l2.timeline.push({ ts: ago(95), type: 'consent', text: 'Customer opted in on WhatsApp' }, { ts: ago(80), type: 'needs', text: 'Need analysis completed by customer' });
  pushMsg(`customer:${l2.id}`, { dir: 'out', type: 'text', text: 'Thank you. Let’s start by understanding what you need.', ts: ago(95) });
  pushMsg(`customer:${l2.id}`, { dir: 'out', type: 'text', text: '*Here is what I worked out for you*\n\n(Seeded conversation: need analysis completed 80 hours ago.)', ts: ago(80) });

  // 3. Illustration shared 50h ago, not reviewed → stale
  const p3 = { age: 41, gender: 'male', maritalStatus: 'married', dependents: 3, youngestChildAge: 9, annualIncome: 3600000, monthlyExpenses: 150000, liabilities: 2000000, existingCover: 10000000, retirementAge: 60 };
  const n3 = analyseNeeds(p3, ['child_education', 'wealth'], 'high');
  n3.generatedAt = ago(60);
  const l3 = mk({
    name: 'Vikram Shah', mobile: '9820033333', source: 'Bank branch', createdAt: ago(120), updatedAt: ago(50), lastActivityAt: ago(50),
    stage: 'bi_shared', consent: { given: true, at: ago(118), channel: 'whatsapp' }, lastCustomerInboundAt: ago(58),
    profile: p3, goals: n3.goals, risk: 'high', needs: n3, recommendedProductIds: n3.recommendedProductIds,
  });
  const bi3 = generateIllustration('prlpplus', { age: 41, gender: 'male', annualPremium: 250000, sumAssured: 2500000 }, { id: nextId.bi(), now: new Date(ago(50)) });
  db.illustrations[bi3.illustrationId] = { ...bi3, leadId: l3.id, createdBy: 'agent', sharedAt: ago(50), acknowledgedAt: null };
  l3.illustrationIds.push(bi3.illustrationId);
  l3.timeline.push({ ts: ago(60), type: 'needs', text: 'Need analysis completed by agent' }, { ts: ago(50), type: 'illustration', text: `Illustration ${bi3.illustrationId} (${bi3.productName}) shared` });
  pushMsg(`customer:${l3.id}`, { dir: 'out', type: 'document', text: `📄 *Benefit illustration: ${bi3.productName}*\n_Seeded: shared 50 hours ago, not reviewed yet._`, document: { illustrationId: bi3.illustrationId, filename: `${bi3.illustrationId}_prlpplus.pdf`, url: `/api/illustrations/${bi3.illustrationId}.pdf` }, ts: ago(50) });

  // 4. Proposal in progress
  mk({ name: 'Meera Iyer', mobile: '9820044444', source: 'Campaign', createdAt: ago(200), updatedAt: ago(20), lastActivityAt: ago(20), stage: 'proposal', consent: { given: true, at: ago(199) } });

  // 5. Issued
  mk({ name: 'Sanjay Kulkarni', mobile: '9820055555', source: 'Referral', createdAt: ago(400), updatedAt: ago(100), lastActivityAt: ago(100), stage: 'issued', consent: { given: true, at: ago(399) } });

  pushMsg('agent:agent-1', { dir: 'out', type: 'text', text: 'Welcome to Sales Assist. Send "Hi" to open the menu.', ts: ago(1) });
}
