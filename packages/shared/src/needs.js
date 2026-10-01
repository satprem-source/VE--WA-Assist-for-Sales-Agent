/**
 * Need analysis: protection gap (HLV), goal corpus gaps, product mix.
 *
 * All assumptions live in NEED_ASSUMPTIONS so business users can tune them
 * without touching the maths. These are planning heuristics for a sales
 * conversation, not actuarial advice.
 */
import { PRODUCTS, getProduct, GOAL_LABELS } from './products.js';

export const NEED_ASSUMPTIONS = {
  selfConsumptionShare: 0.3, // share of income the insured spends on self (excluded from HLV)
  incomeGrowth: 0.06,
  discountRate: 0.08,
  generalInflation: 0.06,
  educationInflation: 0.1,
  educationTargetAge: 18,
  educationCostToday: 2500000, // default cost of a graduate programme today, if not provided
  postRetirementReturn: 0.07,
  lifeExpectancy: 85,
  defaultRetirementAge: 60,
  healthCoverPerDependent: 500000,
  minHealthCover: 1000000,
};

const round = (n, to = 100000) => Math.max(0, Math.round(n / to) * to);

/** Present value of a growing annuity (payments at year end). */
function pvGrowingAnnuity(payment, growth, rate, years) {
  if (years <= 0) return 0;
  if (Math.abs(rate - growth) < 1e-9) return (payment * years) / (1 + rate);
  return (payment / (rate - growth)) * (1 - Math.pow((1 + growth) / (1 + rate), years));
}

/** Present value of an inflation-linked annuity-due, used for retirement corpus. */
function pvAnnuityDue(payment, growth, rate, years) {
  if (years <= 0) return 0;
  const real = (1 + rate) / (1 + growth) - 1;
  if (Math.abs(real) < 1e-9) return payment * years;
  return payment * ((1 - Math.pow(1 + real, -years)) / real) * (1 + real);
}

export function humanLifeValue({ age, annualIncome, retirementAge }, a = NEED_ASSUMPTIONS) {
  const years = Math.max(0, (retirementAge || a.defaultRetirementAge) - age);
  const familyShare = annualIncome * (1 - a.selfConsumptionShare);
  return pvGrowingAnnuity(familyShare, a.incomeGrowth, a.discountRate, years);
}

export function protectionGap(profile, a = NEED_ASSUMPTIONS) {
  const hlv = humanLifeValue(profile, a);
  const required = hlv + (profile.liabilities || 0);
  const gap = required - (profile.existingCover || 0);
  return { hlv: round(hlv), required: round(required), existing: profile.existingCover || 0, gap: round(gap) };
}

export function educationCorpus({ youngestChildAge, educationCostToday }, a = NEED_ASSUMPTIONS) {
  if (youngestChildAge == null || youngestChildAge === '' || youngestChildAge >= a.educationTargetAge) return null;
  const years = a.educationTargetAge - youngestChildAge;
  const cost = educationCostToday || a.educationCostToday;
  const future = cost * Math.pow(1 + a.educationInflation, years);
  return { yearsToGoal: years, costToday: cost, corpusRequired: round(future) };
}

export function retirementCorpus({ age, retirementAge, monthlyExpenses }, a = NEED_ASSUMPTIONS) {
  const ra = retirementAge || a.defaultRetirementAge;
  const yearsToRetire = Math.max(0, ra - age);
  const annualAtRetirement = (monthlyExpenses || 0) * 12 * Math.pow(1 + a.generalInflation, yearsToRetire);
  const yearsInRetirement = Math.max(0, a.lifeExpectancy - Math.max(ra, age));
  const corpus = pvAnnuityDue(annualAtRetirement, a.generalInflation, a.postRetirementReturn, yearsInRetirement);
  return { yearsToRetire, annualExpenseAtRetirement: round(annualAtRetirement, 1000), corpusRequired: round(corpus) };
}

export function healthCover({ dependents }, a = NEED_ASSUMPTIONS) {
  const members = 1 + (dependents || 0);
  return { recommendedCover: Math.max(a.minHealthCover, members * a.healthCoverPerDependent) };
}

/** Rank products for one goal given profile + risk appetite. Returns product ids, best first. */
function pickProducts(goal, { age, risk, yearsToRetire }) {
  const byId = (ids) => ids.map(getProduct).filter(Boolean).map((p) => p.id);
  switch (goal) {
    case 'protection':
      return byId(age <= 45 ? ['mrss', 'srp'] : ['srp', 'mrss']);
    case 'child_education':
      return byId(risk === 'low' ? ['grip', 'fgp', 'sfip'] : risk === 'high' ? ['prlpplus', 'fgp'] : ['fgp', 'prlpplus', 'grip']);
    case 'wealth':
      return byId(risk === 'low' ? ['grip', 'fgp'] : ['prlpplus', 'premiersip', 'fgp']);
    case 'regular_income':
      return byId(['sfip', 'fgp', 'premiersip']);
    case 'retirement':
      if (yearsToRetire <= 2) return byId(['fgpension']);
      return byId(risk === 'low' || yearsToRetire < 10 ? ['fgpension', 'sps'] : ['sps', 'fgpension']);
    case 'health':
      return byId(['prlpplus', 'premiersip']);
    default:
      return [];
  }
}

const RATIONALE = {
  protection: 'Cover the income your family would lose, plus outstanding loans.',
  child_education: 'Build a corpus timed to when your child starts higher education.',
  wealth: 'Grow long-term savings in line with your comfort with market ups and downs.',
  regular_income: 'Create a steady income stream alongside your salary or after it.',
  retirement: 'Fund your expenses from retirement until age 85.',
  health: 'Health benefits come bundled with a life plan in this catalogue (standalone riders are out of scope for v1).',
};

/**
 * Full need analysis.
 * @param {object} profile { age, gender, maritalStatus, dependents, youngestChildAge, annualIncome,
 *   monthlyExpenses, liabilities, existingCover, retirementAge }
 * @param {string[]} goals
 * @param {'low'|'moderate'|'high'} risk
 */
export function analyseNeeds(profile, goals = [], risk = 'moderate', a = NEED_ASSUMPTIONS) {
  const p = normaliseProfile(profile);
  const result = { profile: p, goals, risk, generatedAt: null, gaps: {}, recommendations: [] };

  const retirement = retirementCorpus(p, a);
  const ctx = { age: p.age, risk, yearsToRetire: retirement.yearsToRetire };

  for (const goal of goals) {
    let gap = null;
    if (goal === 'protection') gap = protectionGap(p, a);
    if (goal === 'child_education') gap = educationCorpus(p, a);
    if (goal === 'retirement') gap = retirement;
    if (goal === 'health') gap = healthCover(p, a);
    if (goal === 'child_education' && !gap) continue; // no child under target age
    result.gaps[goal] = gap;
    result.recommendations.push({
      goal,
      goalLabel: GOAL_LABELS[goal],
      rationale: RATIONALE[goal],
      productIds: pickProducts(goal, ctx),
    });
  }

  // Protection is always surfaced if there are dependents and it wasn't picked.
  if (!goals.includes('protection') && p.dependents > 0) {
    const gap = protectionGap(p, a);
    if (gap.gap > 0) {
      result.gaps.protection = gap;
      result.recommendations.unshift({
        goal: 'protection',
        goalLabel: GOAL_LABELS.protection,
        rationale: `You have ${p.dependents} dependent(s) and a cover gap, so protection is flagged even though you didn't select it.`,
        productIds: pickProducts('protection', ctx),
        suggested: true,
      });
    }
  }

  const seen = new Set();
  result.recommendedProductIds = result.recommendations.flatMap((r) => r.productIds).filter((id) => !seen.has(id) && seen.add(id));
  return result;
}

export function normaliseProfile(profile = {}) {
  const num = (v, d = 0) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));
  return {
    age: num(profile.age, 30),
    gender: profile.gender || 'male',
    maritalStatus: profile.maritalStatus || 'single',
    dependents: num(profile.dependents, 0),
    youngestChildAge: profile.youngestChildAge === '' || profile.youngestChildAge == null ? null : num(profile.youngestChildAge),
    annualIncome: num(profile.annualIncome, 0),
    monthlyExpenses: num(profile.monthlyExpenses, 0),
    liabilities: num(profile.liabilities, 0),
    existingCover: num(profile.existingCover, 0),
    retirementAge: num(profile.retirementAge, NEED_ASSUMPTIONS.defaultRetirementAge),
    tobacco: profile.tobacco === true || profile.tobacco === 'yes',
  };
}

export { PRODUCTS };
