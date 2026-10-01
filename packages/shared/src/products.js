/**
 * Product catalogue — Tata AIA, v1.
 *
 * Scope rule: only plans with an online-purchase link on
 * https://www.tataaia.com/life-insurance-plans.html (checked 2026-09-30).
 * UINs are copied exactly as printed on that page. Do NOT substitute
 * nearest versions; if a UIN changes, update it here deliberately.
 *
 * Out of scope for v1 (by decision): Shubh Shakti Select (no UIN on page),
 * all standalone riders.
 *
 * `indicativeEligibility` values are PLACEHOLDERS for driving the mock UI.
 * They are not Tata AIA's filed eligibility. Replace with insurer
 * quote/eligibility APIs in production.
 */

export const INSURER = 'Tata AIA';
export const CATALOGUE_SOURCE = {
  url: 'https://www.tataaia.com/life-insurance-plans.html',
  checkedOn: '2026-09-30',
};

/** @typedef {'term'|'savings_nonpar'|'savings_par'|'ulip'|'ulip_pension'|'annuity'|'health'|'bundle'} Category */
/** @typedef {'protection'|'child_education'|'retirement'|'wealth'|'regular_income'|'health'} Goal */

export const CATEGORY_LABELS = {
  term: 'Term insurance',
  savings_nonpar: 'Guaranteed savings',
  savings_par: 'Participating savings',
  ulip: 'Unit-linked (ULIP)',
  ulip_pension: 'Unit-linked pension',
  annuity: 'Annuity',
  health: 'Health',
  bundle: 'ULIP + health solution',
};

export const GOAL_LABELS = {
  protection: 'Family protection',
  child_education: "Child's education",
  retirement: 'Retirement income',
  wealth: 'Wealth creation',
  regular_income: 'Regular income',
  health: 'Health cover',
};

const SELL_ONLINE = (productCode, tag) =>
  `https://sellonline.tataaia.com/wps/PA_TATAAIA_SO/CampaignRedirection?campaign=BO&product=${productCode}&camcode=1013&cid=website:link:lifeinsurancepage_onlineplancards::${tag}:productcard:1013`;

/** Component products — sold inside the two bundles below. */
const COMPONENTS = [
  {
    uin: '110L179V02',
    name: 'Smart Sampoorna Raksha Supreme',
    category: 'ulip',
    regulatoryType: 'Unit Linked, Non-Participating Individual Life Insurance Plan',
    illustrationModel: 'ulip',
    componentOnly: true,
  },
  {
    uin: '110N183V02',
    name: 'Health Buddy',
    category: 'health',
    regulatoryType: 'Non-Participating, Non-Linked, Individual Health Product',
    illustrationModel: 'health',
    componentOnly: true,
  },
  {
    uin: '110L174V01',
    name: 'Smart SIP',
    category: 'ulip',
    regulatoryType: 'Non-participating, Unit-linked, Individual Life Insurance Savings Plan',
    illustrationModel: 'ulip',
    componentOnly: true,
  },
  {
    uin: '110N178V01',
    name: 'Vitality Protect Advance',
    category: 'health',
    regulatoryType: 'Individual, Non-linked, Non-participating Health Insurance Plan',
    illustrationModel: 'health',
    componentOnly: true,
  },
];

/** Plans offered to customers in the prototype. */
const OFFERED = [
  {
    id: 'srp',
    uin: '110N176V12',
    name: 'Sampoorna Raksha Promise',
    category: 'term',
    regulatoryType: 'Non-Linked, Non-Participating, Pure Risk, Individual Life Insurance Product',
    goals: ['protection'],
    highlights: ['Pure life cover for your family', 'Return of premium option'],
    illustrationModel: 'term',
    sellOnlineUrl: SELL_ONLINE(373, 'sampoornarakshapromise'),
    indicativeEligibility: { entryAge: [18, 65], minSumAssured: 2500000 },
  },
  {
    id: 'mrss',
    uin: '110N171V15',
    name: 'Maha Raksha Supreme Select',
    category: 'term',
    regulatoryType: 'Non-Linked, Non-Participating, Pure Risk, Individual Life Insurance Product',
    goals: ['protection'],
    highlights: ['High life cover', 'Option to increase cover at life milestones'],
    illustrationModel: 'term',
    sellOnlineUrl: SELL_ONLINE(367, 'mrsselect'),
    indicativeEligibility: { entryAge: [18, 60], minSumAssured: 5000000 },
  },
  {
    id: 'fgp',
    uin: '110N158V14',
    name: 'Fortune Guarantee Plus',
    category: 'savings_nonpar',
    regulatoryType: 'Non-Linked, Non-Participating, Individual Life Insurance Savings Plan',
    goals: ['child_education', 'wealth', 'regular_income'],
    highlights: ['Guaranteed benefits', 'Premium-back option'],
    illustrationModel: 'guaranteed_savings',
    sellOnlineUrl: SELL_ONLINE(357, 'fgplus'),
    indicativeEligibility: { entryAge: [0, 60], minAnnualPremium: 30000 },
  },
  {
    id: 'sfip',
    uin: '110N207V03',
    name: 'Shubh Flexi Income Plan',
    category: 'savings_par',
    regulatoryType: 'Individual, non-linked, participating, Life Insurance Savings Plan',
    goals: ['regular_income', 'child_education'],
    highlights: [
      'Income can start soon after policy issuance',
      'Cash bonus from the first policy month/year',
      'Sub-wallet to grow income and withdraw when needed',
    ],
    illustrationModel: 'par_income',
    sellOnlineUrl: SELL_ONLINE(389, 'shubhflexiincomeplan'),
    indicativeEligibility: { entryAge: [0, 60], minAnnualPremium: 30000 },
  },
  {
    id: 'grip',
    uin: '110N163V13',
    name: 'Guaranteed Return Insurance Plan',
    category: 'savings_nonpar',
    regulatoryType: 'Individual, Non-Linked, Non-participating, Life Insurance Savings Plan',
    goals: ['child_education', 'wealth'],
    highlights: ['Guaranteed returns', 'Guaranteed additions with the Endowment option'],
    illustrationModel: 'guaranteed_savings',
    sellOnlineUrl: SELL_ONLINE(348, 'grip'),
    indicativeEligibility: { entryAge: [0, 60], minAnnualPremium: 30000 },
  },
  {
    id: 'prlpplus',
    uin: '110L179V02+110N183V02',
    name: 'Param Raksha Life Pro+',
    category: 'bundle',
    regulatoryType: 'Solution combining two separately filed products (both also sold individually)',
    bundle: { components: ['110L179V02', '110N183V02'] },
    goals: ['wealth', 'protection', 'health', 'child_education'],
    highlights: ['High life cover with market-linked growth', 'Health cover through Health Buddy'],
    illustrationModel: 'bundle',
    marketLinked: true,
    sellOnlineUrl: SELL_ONLINE(378, 'paramrakshalifepro'),
    indicativeEligibility: { entryAge: [18, 60], minAnnualPremium: 24000 },
  },
  {
    id: 'premiersip',
    uin: '110L174V01+110N178V01',
    name: 'Premier SIP',
    category: 'bundle',
    regulatoryType: 'Solution combining two separately filed products (both also sold individually)',
    bundle: { components: ['110L174V01', '110N178V01'] },
    goals: ['wealth', 'health', 'regular_income'],
    highlights: ['No premium allocation charges', 'Smart withdrawal strategies for a second income'],
    illustrationModel: 'bundle',
    marketLinked: true,
    sellOnlineUrl: SELL_ONLINE(386, 'premiersip'),
    indicativeEligibility: { entryAge: [18, 60], minAnnualPremium: 24000 },
  },
  {
    id: 'sps',
    uin: '110L182V09',
    name: 'Smart Pension Secure',
    category: 'ulip_pension',
    regulatoryType: 'Non-Participating, Unit Linked, Individual Life Insurance Pension Plan',
    goals: ['retirement'],
    highlights: ['Pension benefits with life cover', 'Zero premium allocation charges'],
    illustrationModel: 'ulip_pension',
    marketLinked: true,
    sellOnlineUrl: SELL_ONLINE(383, 'smartpensionsecure'),
    indicativeEligibility: { entryAge: [18, 65], minAnnualPremium: 24000 },
  },
  {
    id: 'fgpension',
    uin: '110N161V13',
    name: 'Fortune Guarantee Pension',
    category: 'annuity',
    regulatoryType: 'Non-Linked, Non-Participating, Annuity Plan',
    goals: ['retirement', 'regular_income'],
    highlights: ['Lifelong guaranteed income', 'Joint-life option to cover your spouse', 'Return of purchase price option'],
    illustrationModel: 'annuity',
    sellOnlineUrl: SELL_ONLINE(343, 'fgpension'),
    indicativeEligibility: { entryAge: [30, 85], minPurchasePrice: 100000 },
  },
];

export const COMPONENT_PRODUCTS = COMPONENTS.map((p) => ({ insurer: INSURER, ...p }));
export const PRODUCTS = OFFERED.map((p) => ({ insurer: INSURER, componentOnly: false, ...p }));

export function getProduct(idOrUin) {
  return (
    PRODUCTS.find((p) => p.id === idOrUin || p.uin === idOrUin) ||
    COMPONENT_PRODUCTS.find((p) => p.uin === idOrUin) ||
    null
  );
}

export function productsForGoal(goal) {
  return PRODUCTS.filter((p) => p.goals.includes(goal));
}
