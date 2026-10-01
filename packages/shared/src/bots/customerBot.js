/**
 * Customer bot: the customer's chat with the business WhatsApp number.
 *
 * Routing is mostly by reply id (e.g. "prod:fgp", "cmpB:fgp:grip"), so the bot
 * is close to stateless. Anything durable (profile, needs, illustrations,
 * stage) lives on the lead via `services`.
 *
 * services: see apps/mock-api/src/services.js
 */
import { getProduct } from '../products.js';
import { analyseNeeds } from '../needs.js';
import { DOC_TYPES, getDocType, classifyDocument, validateUpload, checklist } from '../documents.js';
import { interpretVoice, describeSlots, VOICE_MENU_ID } from '../voice.js';
import {
  text, buttons, list, profileFlow, goalsFlow, needsSummaryText, recommendedListMessage,
  allProductsList, productCardText, comparison, biInputsFlow, documentMessage,
} from './messages.js';

const MENU_ID = 'menu';

export const consentMessage = (lead, agentName) => ({
  ...buttons(
    `Hi ${lead.name.split(' ')[0]}, this is the assistant for ${agentName}, your insurance advisor.\n\n` +
    'I can help you work out how much cover you need, compare Tata AIA plans and share illustrations here on WhatsApp.\n\n' +
    'Is it okay to message you about this? You can reply STOP anytime.',
    [{ id: 'consent:yes', title: 'Yes, continue' }, { id: 'consent:no', title: 'Not now' }],
  ),
  meta: { template: 'nb_intro_consent' },
});

export const menuMessage = (lead) => list(
  `What would you like to do${lead?.name ? ', ' + lead.name.split(' ')[0] : ''}?`,
  'Menu',
  [{
    title: 'Plan',
    rows: [
      { id: 'menu:needs', title: 'Work out my needs', description: 'About 2 minutes' },
      { id: 'menu:plans', title: 'See my plans', description: 'Plans that match your goals' },
      { id: 'menu:compare', title: 'Compare two plans', description: 'Side by side, indicative' },
      { id: 'menu:bis', title: 'My illustrations', description: 'Documents shared with you' },
      { id: 'menu:docs', title: 'Upload documents', description: 'PAN card, photo and more' },
      { id: 'menu:advisor', title: 'Talk to my advisor', description: 'Ask for a call back' },
    ],
  }],
);

const backToMenu = { id: MENU_ID, title: 'Menu' };

const docsMenu = async (leadId, s) => {
  const { text: items, complete } = checklist(await s.listDocuments(leadId));
  return list(
    `*Documents for your application*\n${items}\n\n${complete ? 'You have sent everything required. You can replace or add more.' : 'Choose one to send. You can also just send the photo or PDF here.'}`,
    'Choose document',
    [{ title: 'Documents', rows: DOC_TYPES.map((d) => ({ id: `docs:ask:${d.id}`, title: d.label, description: d.required ? 'Required' : 'Optional' })) }],
  );
};

const tagList = () => list('Which document is this?', 'Choose', [{ title: 'Documents', rows: DOC_TYPES.map((d) => ({ id: `docs:tag:${d.id}`, title: d.label, description: '' })) }]);

/** Save a received file against a type, tell the advisor, and show what is still missing. */
async function storeDocument(lead, typeId, inbound, s) {
  const type = getDocType(typeId);
  const doc = await s.attachDocument(lead.id, typeId, inbound);
  const { text: items, missing, complete } = checklist(await s.listDocuments(lead.id));
  await s.notifyAgent(lead, `📎 ${lead.name} sent their ${type.label}.${complete ? ' All required documents are in. Review them on the dashboard.' : ''}`, lead.id);
  const next = missing[0];
  return [{
    ...buttons(
      `Got your *${type.label}* ✅\n\n${items}\n\n${complete ? 'Everything required is in. Your advisor will review it.' : `Next: *${next.label}*, ${next.hint}.`}`,
      [next ? { id: `docs:ask:${next.id}`, title: `Send ${next.short}` } : { id: 'docs:menu', title: 'Add another' }, { id: 'docs:menu', title: 'All documents' }, backToMenu],
    ),
    meta: { documentId: doc.id },
  }];
}

async function handleMedia(lead, inbound, s) {
  const typeId = lead.awaitingDoc || classifyDocument(inbound.caption, inbound.filename);
  const check = validateUpload(typeId, inbound);
  if (!check.ok) return [text(`${check.error}${typeId ? ` I'm still waiting for your ${getDocType(typeId).label}.` : ''}`)];
  if (typeId) return storeDocument(lead, typeId, inbound, s);
  await s.updateLead(lead.id, { pendingMedia: inbound });
  return [tagList()];
}

/** Voice note → transcript → intent, routed like a tap so every guard still applies. */
async function handleVoice(lead, inbound, s) {
  const leadId = lead.id;
  const transcript = (inbound.transcript || (await s.transcribe?.(inbound)) || '').trim();
  if (!transcript) {
    await s.logEvent(leadId, 'voice', 'Voice note received but could not be transcribed');
    return [text('I could not make out that voice note. Please record it again, or type your message.')];
  }
  const secs = inbound.durationSec ? ` (${Math.round(inbound.durationSec)}s)` : '';
  await s.logEvent(leadId, 'voice', `Voice note${secs}: “${transcript.slice(0, 140)}”`);
  const heard = text(`🎙️ _I heard:_ “${transcript}”`);
  const { intent, slots } = interpretVoice(transcript);
  const picked = describeSlots(slots);

  if (intent === 'opt_out') {
    return [heard, buttons('Do you want me to stop messaging you?', [{ id: 'optout:confirm', title: 'Yes, stop' }, backToMenu])];
  }
  if (intent === 'needs') {
    const flow = profileFlow('need_profile', { ...(lead.profile || {}), ...slots });
    if (picked) flow.text = `I picked up: ${picked}.\n\nCheck these and fill in the rest. It takes about a minute.`;
    return [heard, flow];
  }
  if (intent === 'documents') return [heard, await docsMenu(leadId, s)];
  if (intent) return [heard, ...(await handleCustomerInbound(leadId, { type: 'button_reply', id: VOICE_MENU_ID[intent], title: intent }, s))];
  return [heard, buttons('I was not sure what you need. Pick one, or say it again.', [{ id: 'menu:needs', title: 'Work out my needs' }, { id: 'menu:plans', title: 'See my plans' }, backToMenu])];
}

export async function handleCustomerInbound(leadId, inbound, s) {
  const lead = await s.getLead(leadId);
  if (!lead) return [text('Sorry, I could not find your details.')];
  const agent = await s.getAgent(lead.agentId);
  const id = inbound.id || '';
  const out = [];

  // STOP always wins.
  if (inbound.type === 'text' && /^\s*stop\s*$/i.test(inbound.text)) {
    await s.updateLead(leadId, { consent: { given: false, withdrawnAt: s.now().toISOString() } });
    await s.logEvent(leadId, 'consent', 'Customer opted out (STOP)');
    return [text('You have been opted out. Reply START to opt back in.')];
  }
  if (inbound.type === 'text' && /^\s*start\s*$/i.test(inbound.text)) {
    return [consentMessage(lead, agent.name)];
  }

  // Consent gate (DPDP: purpose-specific consent before processing personal data).
  if (!lead.consent?.given) {
    if (id === 'consent:yes') {
      await s.updateLead(leadId, { consent: { given: true, at: s.now().toISOString(), channel: 'whatsapp' } });
      await s.logEvent(leadId, 'consent', 'Customer opted in on WhatsApp');
      await s.notifyAgent(lead, `${lead.name} opted in. The needs form is now with them.`);
      out.push(text('Thank you. Let’s start by understanding what you need.'));
      out.push(profileFlow(`need_profile`, lead.profile || {}));
      return out;
    }
    if (id === 'consent:no') {
      await s.logEvent(leadId, 'consent', 'Customer declined for now');
      await s.notifyAgent(lead, `${lead.name} said "Not now" to the opt-in message.`);
      return [text('No problem. Send "Hi" whenever you’re ready.')];
    }
    return [consentMessage(lead, agent.name)];
  }

  // Flow submissions
  if (inbound.type === 'flow_submit') {
    const fid = inbound.flowId || '';
    if (fid === 'need_profile') {
      await s.updateLead(leadId, { profile: { ...(lead.profile || {}), ...inbound.data } });
      await s.logEvent(leadId, 'needs', 'Customer filled in profile');
      return [goalsFlow('need_goals', { goals: lead.goals || [], risk: lead.risk || 'moderate' })];
    }
    if (fid === 'need_goals') {
      const goals = [].concat(inbound.data.goals || []);
      const risk = inbound.data.risk || 'moderate';
      const fresh = await s.getLead(leadId);
      const needs = analyseNeeds(fresh.profile, goals, risk);
      needs.generatedAt = s.now().toISOString();
      await s.recordNeeds(leadId, { goals, risk, needs, by: 'customer' });
      await s.notifyAgent(fresh, `✅ ${fresh.name} completed the need analysis (${goals.length} goal(s)).`, leadId);
      return [
        text(needsSummaryText(needs)),
        buttons('Want to see plans that fit?', [{ id: 'menu:plans', title: 'See my plans' }, { id: 'menu:advisor', title: 'Talk to advisor' }]),
      ];
    }
    if (fid.startsWith('bi_inputs:')) {
      const productId = fid.split(':')[1];
      const bi = await s.createIllustration(leadId, productId, inbound.data, { by: 'customer', shared: true });
      await s.notifyAgent(lead, `📄 ${lead.name} created an illustration for ${bi.productName}.`, leadId);
      return [
        documentMessage(bi),
        buttons('Please review the illustration. Tap below once you have gone through it.', [
          { id: `ack:${bi.illustrationId}`, title: "I've reviewed it" },
          { id: 'menu:advisor', title: 'Talk to advisor' },
          backToMenu,
        ]),
      ];
    }
  }

  // Voice notes and file uploads
  if (inbound.type === 'audio') return handleVoice(lead, inbound, s);
  if (inbound.type === 'image' || inbound.type === 'document') return handleMedia(lead, inbound, s);

  // Reply ids
  if (id === 'optout:confirm') {
    await s.updateLead(leadId, { consent: { given: false, withdrawnAt: s.now().toISOString() } });
    await s.logEvent(leadId, 'consent', 'Customer opted out (voice note)');
    return [text('You have been opted out. Reply START to opt back in.')];
  }

  if (id === 'menu:docs' || id === 'docs:menu') {
    await s.updateLead(leadId, { awaitingDoc: null });
    return [await docsMenu(leadId, s)];
  }
  if (id.startsWith('docs:ask:')) {
    const type = getDocType(id.split(':')[2]);
    await s.updateLead(leadId, { awaitingDoc: type.id });
    return [buttons(`Please send your *${type.label}* now: ${type.hint}.\n\nUse the 📎 button to attach ${type.accept.includes('pdf') ? 'a photo or PDF' : 'a photo'}.`, [{ id: 'docs:menu', title: 'Back' }])];
  }
  if (id.startsWith('docs:tag:')) {
    const typeId = id.split(':')[2];
    const media = lead.pendingMedia;
    if (!media) return [await docsMenu(leadId, s)];
    const check = validateUpload(typeId, media);
    if (!check.ok) return [text(check.error), tagList()];
    await s.updateLead(leadId, { pendingMedia: null });
    return storeDocument(lead, typeId, media, s);
  }

  if (id === 'menu:needs') return [profileFlow('need_profile', lead.profile || {})];

  if (id === 'menu:plans') {
    if (!lead.needs) return [buttons('Let’s work out your needs first so I can suggest the right plans.', [{ id: 'menu:needs', title: 'Start' }, backToMenu])];
    return [recommendedListMessage(lead.needs, 'prod')];
  }

  if (id === 'menu:compare') return [allProductsList('Pick the first plan to compare.', (p) => `cmpA:${p.id}`)];

  if (id === 'menu:bis') {
    const bis = await s.listIllustrations(leadId, { sharedOnly: true });
    if (!bis.length) return [buttons('No illustrations yet. Pick a plan to create one.', [{ id: 'menu:plans', title: 'See my plans' }, backToMenu])];
    return [list('Your illustrations', 'Open', [{ title: 'Shared with you', rows: bis.slice(-10).reverse().map((b) => ({ id: `doc:${b.illustrationId}`, title: b.productName, description: `${b.illustrationId} · ${b.acknowledgedAt ? 'Reviewed' : 'Not reviewed yet'}` })) }])];
  }

  if (id === 'menu:advisor') {
    await s.logEvent(leadId, 'callback', 'Customer asked to talk to advisor');
    await s.notifyAgent(lead, `📞 ${lead.name} asked you to get in touch.`, leadId);
    return [text(`I’ve asked ${agent.name} to get in touch with you shortly.`)];
  }

  if (id.startsWith('prod:')) {
    const p = getProduct(id.split(':')[1]);
    return [buttons(productCardText(p), [
      { id: `bi:${p.id}`, title: 'Get illustration' },
      { id: `cmpA:${p.id}`, title: 'Compare' },
      { id: 'menu:plans', title: 'Back to plans' },
    ])];
  }

  if (id.startsWith('cmpA:')) {
    const a = id.split(':')[1];
    return [allProductsList(`Compare *${getProduct(a).name}* with…`, (p) => `cmpB:${a}:${p.id}`, a)];
  }

  if (id.startsWith('cmpB:')) {
    const [, a, b] = id.split(':');
    const c = comparison(a, b, lead.profile);
    await s.recordComparison(leadId, { a: c.a, b: c.b, by: 'customer' });
    return [
      text(c.text),
      buttons('Get a detailed illustration for either plan.', [
        { id: `bi:${a}`, title: 'Illustrate plan 1' },
        { id: `bi:${b}`, title: 'Illustrate plan 2' },
        backToMenu,
      ]),
    ];
  }

  if (id.startsWith('bi:')) {
    const p = getProduct(id.split(':')[1]);
    return [biInputsFlow(`bi_inputs:${p.id}`, p, lead.profile)];
  }

  if (id.startsWith('doc:')) {
    const bi = await s.getIllustration(id.split(':')[1]);
    return bi ? [documentMessage(bi)] : [text('That illustration is no longer available.')];
  }

  if (id.startsWith('ack:')) {
    const biId = id.split(':')[1];
    const bi = await s.acknowledgeIllustration(biId, 'customer');
    await s.notifyAgent(lead, `👍 ${lead.name} reviewed the illustration for ${bi.productName}.`, leadId);
    return [buttons('Thanks for reviewing it. Would you like to go ahead?', [
      { id: `apply:${biId}`, title: 'Start application' },
      { id: 'menu:advisor', title: 'I have questions' },
      backToMenu,
    ])];
  }

  if (id.startsWith('apply:')) {
    const bi = await s.getIllustration(id.split(':')[1]);
    await s.setStage(leadId, 'proposal', { reason: `Customer chose to apply for ${bi.productName}` });
    await s.notifyAgent(lead, `🚀 ${lead.name} wants to apply for ${bi.productName} (${bi.illustrationId}). Start the proposal.`, leadId);
    return [text(`Great. ${agent.name} will start your application for *${bi.productName}* and share the next steps here. The signed benefit illustration will be part of your proposal.`)];
  }

  // Anything else: greet and show menu.
  return [menuMessage(lead)];
}
