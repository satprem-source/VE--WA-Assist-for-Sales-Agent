/**
 * Agent bot: the advisor's chat with the "Sales Assist" business number.
 * Lets the agent create leads, run need analysis on the customer's behalf or
 * push it to the customer, compare plans, create/share illustrations and
 * manage the pipeline, all from WhatsApp.
 */
import { getProduct } from '../products.js';
import { analyseNeeds } from '../needs.js';
import { STAGES, stageLabel, LOST_REASONS, LEAD_SOURCES, staleness } from '../leads.js';
import { inr } from '../format.js';
import {
  text, buttons, list, profileFlow, goalsFlow, needsSummaryText, recommendedListMessage,
  allProductsList, comparison, biInputsFlow, documentMessage,
} from './messages.js';
import { consentMessage } from './customerBot.js';

const MENU = { id: 'a:menu', title: 'Menu' };

export const agentMenu = (agent) => list(
  `Hi ${agent.name.split(' ')[0]}. What do you want to do?`,
  'Menu',
  [{
    title: 'Sales assist',
    rows: [
      { id: 'a:new', title: 'Add a lead', description: 'Name, mobile, source' },
      { id: 'a:leads', title: 'My leads', description: 'Open a lead to act on it' },
      { id: 'a:stale', title: 'Follow-ups due', description: 'Leads waiting on you or the customer' },
    ],
  }],
);

const NEW_LEAD_FLOW = {
  type: 'flow',
  text: 'Add the customer’s basic details. Nothing is sent to them until you choose to.',
  flow: {
    id: 'a_new_lead', title: 'New lead', cta: 'Add lead',
    fields: [
      { name: 'name', label: 'Customer name', type: 'text', required: true },
      { name: 'mobile', label: 'Mobile (10 digits)', type: 'text', required: true },
      { name: 'source', label: 'Source', type: 'select', options: LEAD_SOURCES },
      { name: 'note', label: 'Note (optional)', type: 'text' },
    ],
    prefill: { source: LEAD_SOURCES[0] },
  },
};

function leadSummary(lead, now) {
  const st = staleness(lead, now);
  const lines = [
    `*${lead.name}*  ·  ${lead.mobile}`,
    `Stage: *${stageLabel(lead.stage)}*${st ? `  ⚠️ ${st.reason}` : ''}`,
    `Opt-in: ${lead.consent?.given ? '✅ yes' : '⏳ not yet'}`,
  ];
  if (lead.needs?.gaps?.protection) lines.push(`Protection gap: ${inr(lead.needs.gaps.protection.gap)}`);
  if (lead.goals?.length) lines.push(`Goals: ${lead.goals.join(', ')}`);
  if (lead.illustrationIds?.length) lines.push(`Illustrations: ${lead.illustrationIds.length}`);
  return lines.join('\n');
}

const leadActions = (lead) => list(leadSummaryPlaceholder, 'Actions', [{
  title: 'Actions',
  rows: [
    { id: `a:send_na:${lead.id}`, title: 'Send needs form', description: 'Customer fills it on WhatsApp' },
    { id: `a:fill_na:${lead.id}`, title: 'Fill needs myself', description: 'You fill, then share' },
    { id: `a:cmp:${lead.id}`, title: 'Compare plans', description: 'Indicative side-by-side' },
    { id: `a:bi:${lead.id}`, title: 'Create illustration', description: 'Watermarked PDF' },
    { id: `a:share:${lead.id}`, title: 'Share illustration', description: 'Send a PDF to the customer' },
    { id: `a:nudge:${lead.id}`, title: 'Send reminder', description: 'Approved template' },
    { id: `a:stage:${lead.id}`, title: 'Update stage', description: 'Move or close the lead' },
  ],
}]);
const leadSummaryPlaceholder = 'Choose an action.';

/** Ensure the customer has opted in; if not, send the opt-in and tell the agent. */
async function requireConsent(lead, s, agent) {
  if (lead.consent?.given) return null;
  await s.sendToCustomer(lead.id, consentMessage(lead, agent.name));
  await s.logEvent(lead.id, 'outbound', 'Opt-in message sent to customer');
  return [buttons(`${lead.name} hasn't opted in yet, so I've sent the opt-in message. You'll be notified when they reply.`, [{ id: `a:lead:${lead.id}`, title: 'Back to lead' }, MENU])];
}

export async function handleAgentInbound(agentId, inbound, s) {
  const agent = await s.getAgent(agentId);
  const id = inbound.id || '';
  const now = s.now().getTime();

  // ---- Flow submissions
  if (inbound.type === 'flow_submit') {
    const fid = inbound.flowId || '';
    if (fid === 'a_new_lead') {
      const mobile = String(inbound.data.mobile || '').replace(/\D/g, '');
      if (!inbound.data.name || mobile.length !== 10) {
        return [text('Enter the customer’s name and a 10-digit mobile number.'), NEW_LEAD_FLOW];
      }
      const lead = await s.createLead({ name: inbound.data.name.trim(), mobile, source: inbound.data.source, note: inbound.data.note, agentId });
      return [buttons(`Added *${lead.name}* (${lead.id}). How do you want to capture their needs?`, [
        { id: `a:send_na:${lead.id}`, title: 'Send needs form' },
        { id: `a:fill_na:${lead.id}`, title: 'Fill it myself' },
        MENU,
      ])];
    }
    if (fid.startsWith('a_need_profile:')) {
      const leadId = fid.split(':')[1];
      const lead = await s.getLead(leadId);
      await s.updateLead(leadId, { profile: { ...(lead.profile || {}), ...inbound.data } });
      await s.logEvent(leadId, 'needs', 'Agent filled in profile');
      return [goalsFlow(`a_need_goals:${leadId}`, { goals: lead.goals || [], risk: lead.risk || 'moderate' })];
    }
    if (fid.startsWith('a_need_goals:')) {
      const leadId = fid.split(':')[1];
      const lead = await s.getLead(leadId);
      const goals = [].concat(inbound.data.goals || []);
      const risk = inbound.data.risk || 'moderate';
      const needs = analyseNeeds(lead.profile, goals, risk);
      needs.generatedAt = s.now().toISOString();
      await s.recordNeeds(leadId, { goals, risk, needs, by: 'agent' });
      return [
        text(needsSummaryText(needs, { forAgent: true, name: lead.name })),
        buttons('Next step?', [
          { id: `a:share_needs:${leadId}`, title: 'Send to customer' },
          { id: `a:bi:${leadId}`, title: 'Create illustration' },
          { id: `a:lead:${leadId}`, title: 'Back to lead' },
        ]),
      ];
    }
    if (fid.startsWith('a_bi:')) {
      const [, leadId, productId] = fid.split(':');
      const bi = await s.createIllustration(leadId, productId, inbound.data, { by: 'agent', shared: false });
      return [
        documentMessage(bi),
        buttons('Check the illustration, then share it with the customer.', [
          { id: `a:share_bi:${bi.illustrationId}`, title: 'Share with customer' },
          { id: `a:bi_p:${leadId}:${productId}`, title: 'Change inputs' },
          { id: `a:lead:${leadId}`, title: 'Back to lead' },
        ]),
      ];
    }
  }

  // ---- Reply ids
  if (id === 'a:new') return [NEW_LEAD_FLOW];

  if (id === 'a:leads') {
    const leads = (await s.listLeads(agentId)).filter((l) => !['issued', 'lost'].includes(l.stage)).slice(0, 10);
    if (!leads.length) return [buttons('No open leads.', [{ id: 'a:new', title: 'Add a lead' }, MENU])];
    return [list('Your open leads (most recent first).', 'Open lead', [{
      title: 'Open leads',
      rows: leads.map((l) => ({ id: `a:lead:${l.id}`, title: l.name, description: `${stageLabel(l.stage)}${staleness(l, now) ? ' · ⚠️ follow up' : ''}` })),
    }])];
  }

  if (id === 'a:stale') {
    const leads = (await s.listLeads(agentId)).map((l) => ({ l, st: staleness(l, now) })).filter((x) => x.st).slice(0, 10);
    if (!leads.length) return [buttons('Nothing overdue. 🎉', [{ id: 'a:leads', title: 'My leads' }, MENU])];
    return [list(`${leads.length} lead(s) need a follow-up.`, 'Open lead', [{
      title: 'Follow-ups due',
      rows: leads.map(({ l, st }) => ({ id: `a:lead:${l.id}`, title: l.name, description: `${st.reason} (${st.hoursIdle}h)` })),
    }])];
  }

  if (id.startsWith('a:lead:')) {
    const lead = await s.getLead(id.split(':')[2]);
    if (!lead) return [text('Lead not found.')];
    await s.setActiveLead(agentId, lead.id);
    return [text(leadSummary(lead, now)), leadActions(lead)];
  }

  if (id.startsWith('a:send_na:')) {
    const lead = await s.getLead(id.split(':')[2]);
    const gate = await requireConsent(lead, s, agent);
    if (gate) return gate;
    await s.sendToCustomer(lead.id, profileFlow('need_profile', lead.profile || {}));
    await s.logEvent(lead.id, 'outbound', 'Need analysis form sent to customer');
    return [buttons(`Sent the needs form to ${lead.name}. I'll let you know when it's done.`, [{ id: `a:lead:${lead.id}`, title: 'Back to lead' }, MENU])];
  }

  if (id.startsWith('a:fill_na:')) {
    const lead = await s.getLead(id.split(':')[2]);
    return [profileFlow(`a_need_profile:${lead.id}`, lead.profile || {}, 'agent')];
  }

  if (id.startsWith('a:share_needs:')) {
    const lead = await s.getLead(id.split(':')[2]);
    const gate = await requireConsent(lead, s, agent);
    if (gate) return gate;
    await s.sendToCustomer(lead.id, { type: 'text', text: needsSummaryText(lead.needs) });
    await s.sendToCustomer(lead.id, recommendedListMessage(lead.needs, 'prod'));
    await s.logEvent(lead.id, 'outbound', 'Need analysis summary and plans sent to customer');
    return [buttons(`Sent the summary and matching plans to ${lead.name}.`, [{ id: `a:lead:${lead.id}`, title: 'Back to lead' }, MENU])];
  }

  if (id.startsWith('a:cmp:')) {
    const leadId = id.split(':')[2];
    return [allProductsList('Pick the first plan.', (p) => `a:cmpA:${leadId}:${p.id}`)];
  }
  if (id.startsWith('a:cmpA:')) {
    const [, , leadId, a] = id.split(':');
    return [allProductsList(`Compare *${getProduct(a).name}* with…`, (p) => `a:cmpB:${leadId}:${a}:${p.id}`, a)];
  }
  if (id.startsWith('a:cmpB:')) {
    const [, , leadId, a, b] = id.split(':');
    const lead = await s.getLead(leadId);
    const c = comparison(a, b, lead.profile);
    return [text(c.text), buttons('What next?', [
      { id: `a:sendcmp:${leadId}:${a}:${b}`, title: 'Send to customer' },
      { id: `a:bi_p:${leadId}:${a}`, title: 'Illustrate plan 1' },
      { id: `a:bi_p:${leadId}:${b}`, title: 'Illustrate plan 2' },
    ])];
  }
  if (id.startsWith('a:sendcmp:')) {
    const [, , leadId, a, b] = id.split(':');
    const lead = await s.getLead(leadId);
    const gate = await requireConsent(lead, s, agent);
    if (gate) return gate;
    const c = comparison(a, b, lead.profile);
    await s.sendToCustomer(leadId, { type: 'text', text: c.text });
    await s.sendToCustomer(leadId, buttons('Want a detailed illustration for either plan?', [
      { id: `bi:${a}`, title: 'Illustrate plan 1' }, { id: `bi:${b}`, title: 'Illustrate plan 2' }, { id: 'menu', title: 'Menu' },
    ]));
    await s.recordComparison(leadId, { a: c.a, b: c.b, by: 'agent' });
    return [buttons(`Comparison sent to ${lead.name}.`, [{ id: `a:lead:${leadId}`, title: 'Back to lead' }, MENU])];
  }

  if (id.startsWith('a:bi:')) {
    const lead = await s.getLead(id.split(':')[2]);
    if (lead.needs) {
      const msg = recommendedListMessage(lead.needs, 'a:bi_p', lead.id);
      msg.text = `Plans that match ${lead.name}'s needs. Pick one to illustrate.`;
      return [msg];
    }
    return [allProductsList(`Pick a plan to illustrate for ${lead.name}.`, (p) => `a:bi_p:${lead.id}:${p.id}`)];
  }
  if (id.startsWith('a:bi_p:')) {
    const [, , leadId, productId] = id.split(':');
    const lead = await s.getLead(leadId);
    return [biInputsFlow(`a_bi:${leadId}:${productId}`, getProduct(productId), lead.profile)];
  }

  if (id.startsWith('a:share:')) {
    const leadId = id.split(':')[2];
    const bis = await s.listIllustrations(leadId);
    if (!bis.length) return [buttons('No illustrations for this lead yet.', [{ id: `a:bi:${leadId}`, title: 'Create illustration' }, MENU])];
    return [list('Which illustration should I share?', 'Choose', [{
      title: 'Illustrations',
      rows: bis.slice(-10).reverse().map((b) => ({ id: `a:share_bi:${b.illustrationId}`, title: b.productName, description: `${b.illustrationId} · ${b.sharedAt ? 'shared' : 'not shared'}` })),
    }])];
  }
  if (id.startsWith('a:share_bi:')) {
    const bi = await s.getIllustration(id.split(':')[2]);
    const lead = await s.getLead(bi.leadId);
    const gate = await requireConsent(lead, s, agent);
    if (gate) return gate;
    await s.shareIllustration(bi.illustrationId, 'agent');
    return [buttons(`Shared ${bi.productName} illustration with ${lead.name}. I'll tell you when they've reviewed it.`, [{ id: `a:lead:${lead.id}`, title: 'Back to lead' }, MENU])];
  }

  if (id.startsWith('a:nudge:')) {
    const lead = await s.getLead(id.split(':')[2]);
    const gate = await requireConsent(lead, s, agent);
    if (gate) return gate;
    await s.sendToCustomer(lead.id, {
      ...buttons(`Hi ${lead.name.split(' ')[0]}, just checking in on your insurance plan. Would you like to continue where you left off?`, [
        { id: 'menu:plans', title: 'See my plans' }, { id: 'menu:bis', title: 'My illustrations' }, { id: 'menu:advisor', title: 'Talk to advisor' },
      ]),
      meta: { template: 'nb_followup_reminder' },
    });
    await s.logEvent(lead.id, 'outbound', 'Reminder sent (template nb_followup_reminder)');
    return [buttons(`Reminder sent to ${lead.name}.`, [{ id: `a:lead:${lead.id}`, title: 'Back to lead' }, MENU])];
  }

  if (id.startsWith('a:stage:')) {
    const leadId = id.split(':')[2];
    return [list('Move this lead to…', 'Choose stage', [{ title: 'Stages', rows: STAGES.map((st) => ({ id: `a:setstage:${leadId}:${st.key}`, title: st.label })) }])];
  }
  if (id.startsWith('a:setstage:')) {
    const [, , leadId, stage] = id.split(':');
    if (stage === 'lost') {
      return [list('Why was it lost?', 'Choose reason', [{ title: 'Reasons', rows: LOST_REASONS.map((r, i) => ({ id: `a:lost:${leadId}:${i}`, title: r })) }])];
    }
    await s.setStage(leadId, stage, { manual: true, reason: 'Updated by agent' });
    return [buttons(`Moved to *${stageLabel(stage)}*.`, [{ id: `a:lead:${leadId}`, title: 'Back to lead' }, MENU])];
  }
  if (id.startsWith('a:lost:')) {
    const [, , leadId, idx] = id.split(':');
    await s.setStage(leadId, 'lost', { manual: true, reason: LOST_REASONS[Number(idx)] });
    await s.updateLead(leadId, { lostReason: LOST_REASONS[Number(idx)] });
    return [buttons(`Marked as lost: ${LOST_REASONS[Number(idx)]}.`, [{ id: 'a:leads', title: 'My leads' }, MENU])];
  }

  return [agentMenu(agent)];
}
