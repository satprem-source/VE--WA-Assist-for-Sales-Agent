import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCustomerInbound, handleAgentInbound } from '@nb/shared';
import { db, seed } from '../src/store.js';
import { services } from '../src/services.js';

const agent = (inbound) => handleAgentInbound('agent-1', inbound, services);
const cust = (id, inbound) => handleCustomerInbound(id, inbound, services);

test('agent-initiated journey: lead → opt-in → needs → compare → BI → ack → apply', async () => {
  seed();
  await agent({ type: 'flow_submit', flowId: 'a_new_lead', data: { name: 'Test User', mobile: '9999999999', source: 'Referral' } });
  const lead = Object.values(db.leads).find((l) => l.mobile === '9999999999');
  assert.equal(lead.stage, 'new');

  const gate = await agent({ type: 'list_reply', id: `a:send_na:${lead.id}` });
  assert.match(gate[0].text, /hasn't opted in/);
  assert.equal(db.conversations[`customer:${lead.id}`].at(-1).meta.template, 'nb_intro_consent');

  const r1 = await cust(lead.id, { type: 'button_reply', id: 'consent:yes' });
  assert.equal(r1.at(-1).type, 'flow');
  await cust(lead.id, { type: 'flow_submit', flowId: 'need_profile', data: { age: 30, dependents: 1, annualIncome: 1500000, monthlyExpenses: 50000 } });
  await cust(lead.id, { type: 'flow_submit', flowId: 'need_goals', data: { goals: ['protection', 'retirement'], risk: 'moderate' } });
  assert.equal(db.leads[lead.id].stage, 'needs_done');

  await cust(lead.id, { type: 'list_reply', id: 'cmpB:srp:mrss' });
  assert.equal(db.leads[lead.id].stage, 'quote_shared');

  const bi = await cust(lead.id, { type: 'flow_submit', flowId: 'bi_inputs:srp', data: { sumAssured: 15000000 } });
  assert.equal(bi[0].type, 'document');
  const biId = bi[0].document.illustrationId;
  assert.equal(db.leads[lead.id].stage, 'bi_shared');

  await cust(lead.id, { type: 'button_reply', id: `ack:${biId}` });
  assert.ok(db.illustrations[biId].acknowledgedAt);
  await cust(lead.id, { type: 'button_reply', id: `apply:${biId}` });
  assert.equal(db.leads[lead.id].stage, 'proposal');

  const notes = db.conversations['agent:agent-1'].filter((m) => m.meta?.notification);
  assert.ok(notes.length >= 4, 'agent is notified at each milestone');
});

test('STOP opts the customer out', async () => {
  seed();
  const id = 'L-1002';
  await cust(id, { type: 'text', text: 'STOP' });
  assert.equal(db.leads[id].consent.given, false);
});
