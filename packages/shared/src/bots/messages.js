/** Message builders shared by the customer and agent bots. */
import { getProduct, PRODUCTS, CATEGORY_LABELS, GOAL_LABELS } from '../products.js';
import { headline, generateIllustration, inputFields, defaultInputs, WATERMARK } from '../illustration.js';
import { inr, pct } from '../format.js';

export const text = (t) => ({ type: 'text', text: t });
export const buttons = (t, btns) => ({ type: 'buttons', text: t, buttons: btns.slice(0, 3) });
export const list = (t, button, sections) => ({
  type: 'list', text: t, list: { button, sections: trimSections(sections) },
});

/** WhatsApp allows at most 10 rows across all sections. */
function trimSections(sections, max = 10) {
  let left = max;
  return sections
    .map((s) => { const rows = s.rows.slice(0, Math.max(0, left)); left -= rows.length; return { ...s, rows }; })
    .filter((s) => s.rows.length);
}

export const PROFILE_FIELDS = [
  { name: 'age', label: 'Age', type: 'number', required: true },
  { name: 'gender', label: 'Gender', type: 'select', options: ['male', 'female'] },
  { name: 'maritalStatus', label: 'Marital status', type: 'select', options: ['single', 'married'] },
  { name: 'dependents', label: 'Number of dependents', type: 'number' },
  { name: 'youngestChildAge', label: "Youngest child's age (leave blank if none)", type: 'number' },
  { name: 'annualIncome', label: 'Annual income (₹)', type: 'number', required: true },
  { name: 'monthlyExpenses', label: 'Monthly household expenses (₹)', type: 'number' },
  { name: 'liabilities', label: 'Outstanding loans (₹)', type: 'number' },
  { name: 'existingCover', label: 'Existing life cover (₹)', type: 'number' },
  { name: 'retirementAge', label: 'Planned retirement age', type: 'number' },
  { name: 'tobacco', label: 'Tobacco user', type: 'toggle' },
];

export const GOAL_FIELDS = [
  { name: 'goals', label: 'What do you want to plan for?', type: 'checkbox', options: Object.keys(GOAL_LABELS).map((k) => ({ value: k, label: GOAL_LABELS[k] })), required: true },
  { name: 'risk', label: 'How do you feel about market ups and downs?', type: 'radio', options: [
    { value: 'low', label: 'I want guaranteed returns' },
    { value: 'moderate', label: 'Some ups and downs are fine' },
    { value: 'high', label: 'I aim for higher long-term growth' },
  ], required: true },
];

export const profileFlow = (flowId, prefill = {}, who = 'you') => ({
  type: 'flow',
  text: who === 'you'
    ? 'Tell me a little about yourself. It takes about a minute, and I only use it to work out what cover you need.'
    : 'Fill in the customer profile. The customer is not messaged until you share.',
  flow: { id: flowId, title: 'About you', cta: 'Start', fields: PROFILE_FIELDS, prefill },
});

export const goalsFlow = (flowId, prefill = {}) => ({
  type: 'flow',
  text: 'Now pick your goals.',
  flow: { id: flowId, title: 'Your goals', cta: 'Choose goals', fields: GOAL_FIELDS, prefill },
});

export function needsSummaryText(needs, { forAgent = false, name } = {}) {
  const lines = [forAgent ? `*Need analysis: ${name}*` : '*Here is what I worked out for you*', ''];
  const g = needs.gaps || {};
  if (g.protection) lines.push(`🛡️ *Protection:* you need about ${inr(g.protection.required)} of life cover. You have ${inr(g.protection.existing)}, so the gap is *${inr(g.protection.gap)}*.`);
  if (g.child_education) lines.push(`🎓 *Education:* about *${inr(g.child_education.corpusRequired)}* in ${g.child_education.yearsToGoal} years (today's cost ${inr(g.child_education.costToday)}, rising with education inflation).`);
  if (g.retirement) lines.push(`🌅 *Retirement:* a corpus of about *${inr(g.retirement.corpusRequired)}* in ${g.retirement.yearsToRetire} years to cover expenses to age 85.`);
  if (g.health) lines.push(`🏥 *Health:* suggested cover of *${inr(g.health.recommendedCover)}* for your family.`);
  if (needs.goals.includes('wealth')) lines.push('📈 *Wealth:* build long-term savings to match your risk comfort.');
  if (needs.goals.includes('regular_income')) lines.push('💰 *Regular income:* set up a steady income stream.');
  lines.push('', `Risk comfort: _${needs.risk}_. These are planning estimates, not advice.`);
  return lines.join('\n');
}

export function recommendedListMessage(needs, prefix = 'prod', leadId) {
  const seen = new Set();
  const sections = needs.recommendations.map((r) => ({
    title: r.goalLabel,
    rows: r.productIds.filter((id) => !seen.has(id) && seen.add(id)).map((id) => {
      const p = getProduct(id);
      return { id: leadId ? `${prefix}:${leadId}:${id}` : `${prefix}:${id}`, title: p.name, description: `${CATEGORY_LABELS[p.category]} · UIN ${p.uin}` };
    }),
  })).filter((s) => s.rows.length);
  return list('These Tata AIA plans match your goals. Pick one to see details.', 'View plans', sections);
}

export function allProductsList(t, idFn, excludeId) {
  const groups = {};
  for (const p of PRODUCTS) {
    if (p.id === excludeId) continue;
    (groups[p.category] ||= []).push(p);
  }
  // Show at most 10 rows; order by category relevance.
  const order = ['term', 'savings_nonpar', 'savings_par', 'bundle', 'ulip_pension', 'annuity'];
  const sections = order.filter((c) => groups[c]).map((c) => ({
    title: CATEGORY_LABELS[c],
    rows: groups[c].map((p) => ({ id: idFn(p), title: p.name, description: `UIN ${p.uin}` })),
  }));
  return list(t, 'Choose plan', sections);
}

export function productCardText(p) {
  return [
    `*${p.name}*`,
    `${CATEGORY_LABELS[p.category]} · Tata AIA`,
    `UIN: ${p.uin}`,
    '',
    ...p.highlights.map((h) => `• ${h}`),
    '',
    `_${p.regulatoryType}_`,
    ...(p.marketLinked ? ['', '_In unit-linked plans, the investment risk is borne by the policyholder._'] : []),
  ].join('\n');
}

/** Compare two products using default inputs from the profile. */
export function comparison(aId, bId, profile) {
  const a = getProduct(aId), b = getProduct(bId);
  const ia = defaultInputs(a, profile), ib = defaultInputs(b, profile);
  const ha = headline(generateIllustration(a.id, ia));
  const hb = headline(generateIllustration(b.id, ib));
  const row = (label, fa, fb) => `*${label}*\n  1️⃣ ${fa}\n  2️⃣ ${fb}`;
  const benefit = (h) =>
    h.annualAnnuity ? `${inr(h.annualAnnuity)}/yr for life`
    : h.pensionAt8 ? `Pension about ${inr(h.pensionAt8)}/yr at 8%`
    : h.maturityGuaranteed != null && h.maturityGuaranteed > 0 ? `${inr(h.maturityGuaranteed)} guaranteed`
    : h.maturityAt8 != null ? `${inr(h.maturityAt4)} at 4% / ${inr(h.maturityAt8)} at 8%`
    : 'No maturity benefit (pure cover)';
  const irrs = (h) => h.irrGuaranteed != null ? pct(h.irrGuaranteed) : h.irrAt8 != null ? `${pct(h.irrAt4)} / ${pct(h.irrAt8)}` : '—';
  const textBody = [
    '*Plan comparison* (indicative)',
    `1️⃣ ${a.name} (${a.uin})`,
    `2️⃣ ${b.name} (${b.uin})`,
    '',
    row('Type', CATEGORY_LABELS[a.category], CATEGORY_LABELS[b.category]),
    row('Yearly premium', inr(ha.premium.annual, { compact: false }), inr(hb.premium.annual, { compact: false })),
    row('Life cover', inr(ha.lifeCover), inr(hb.lifeCover)),
    row('Main benefit', benefit(ha), benefit(hb)),
    row('IRR', irrs(ha), irrs(hb)),
    row('Best for', a.goals.map((g) => GOAL_LABELS[g]).slice(0, 2).join(', '), b.goals.map((g) => GOAL_LABELS[g]).slice(0, 2).join(', ')),
    '',
    `_${WATERMARK}. Based on default inputs; get an illustration for exact figures._`,
  ].join('\n');
  return { text: textBody, a: { id: a.id, uin: a.uin, inputs: ia, headline: ha }, b: { id: b.id, uin: b.uin, inputs: ib, headline: hb } };
}

export function biInputsFlow(flowId, product, profile, prior = {}) {
  return {
    type: 'flow',
    text: `Set the plan details for *${product.name}*. I've filled in sensible starting values.`,
    flow: { id: flowId, title: product.name, cta: 'Set details', fields: inputFields(product), prefill: { ...defaultInputs(product, profile), ...prior } },
  };
}

export function documentMessage(bi) {
  const h = headline(bi);
  const lines = [`📄 *Benefit illustration: ${bi.productName}*`, `UIN ${bi.uin} · Premium ${inr(bi.premium.modal, { compact: false })} ${bi.premium.frequency}`];
  if (h.annualAnnuity) lines.push(`Income: ${inr(h.annualAnnuity)} a year for life`);
  else if (h.maturityGuaranteed) lines.push(`Maturity: ${inr(h.maturityGuaranteed)} guaranteed`);
  else if (h.maturityAt8 != null) lines.push(`Maturity: ${inr(h.maturityAt4)} at 4% / ${inr(h.maturityAt8)} at 8%`);
  else if (h.lifeCover) lines.push(`Life cover: ${inr(h.lifeCover)}`);
  lines.push(`_${WATERMARK}_`);
  return {
    type: 'document',
    text: lines.join('\n'),
    document: { illustrationId: bi.illustrationId, filename: `${bi.illustrationId}_${bi.productId}.pdf`, url: `/api/illustrations/${bi.illustrationId}.pdf` },
  };
}
