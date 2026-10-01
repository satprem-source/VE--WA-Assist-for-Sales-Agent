/**
 * Voice-note understanding.
 *
 * Pipeline: voice note → speech-to-text (a `services.transcribe` seam) → this module
 * turns the transcript into an intent plus any profile details spoken aloud.
 * Rule-based on purpose: deterministic, free, testable offline. A model can replace
 * `interpretVoice` later without touching the bot, as long as the output shape holds.
 *
 * @typedef {{ intent: string|null, confidence: number, slots: Record<string, number> }} VoiceResult
 */
import { inr } from './format.js';

const UNIT = { crore: 1e7, crores: 1e7, cr: 1e7, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, k: 1e3, thousand: 1e3 };
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const AMOUNT = '(?:₹|rs\\.?|inr)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(crores?|cr|lakhs?|lacs?|thousand|k)?\\b';
const PERIOD = '(?:\\s*(per month|a month|monthly|every month|per annum|a year|annually|yearly|per year))?';
const GAP = '[^\\d₹]{0,25}?';

/** "24 lakh" → 2400000. Returns null for a bare small number with no unit (too ambiguous). */
export function toRupees(num, unit) {
  const n = parseFloat(String(num).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = unit ? UNIT[unit.toLowerCase()] : null;
  if (!u && n < 1000) return null;
  return Math.round(n * (u || 1));
}

const monthly = (p) => /month/i.test(p || '');
const num = (s) => (WORDS[s?.toLowerCase()] ?? parseInt(s, 10));

/** Pull spoken profile details out of a transcript. Only returns what it is reasonably sure of. */
export function extractSlots(transcript = '') {
  let t = ` ${transcript.toLowerCase()} `;
  const slots = {};

  const child = t.match(/\b(?:child|kid|son|daughter)\b[^\d]{0,12}(\d{1,2})\s*(?:years?|yrs?)/);
  if (child) { slots.youngestChildAge = +child[1]; t = t.replace(child[0], ' '); }

  const age = t.match(/\b(?:i am|i'm|im|age(?: is)?|aged)\s*(\d{2})\b/) || t.match(/\b(\d{2})\s*(?:years?|yrs?)\s*old\b/);
  if (age && +age[1] >= 18 && +age[1] <= 80) slots.age = +age[1];

  const dep = t.match(/\b(\d+|one|two|three|four|five)\s*(?:kids?|children|child|dependents?)\b/);
  if (dep) slots.dependents = num(dep[1]);

  const inc = t.match(new RegExp(`\\b(?:earn|earning|income|salary|package|ctc)\\b${GAP}${AMOUNT}${PERIOD}`));
  if (inc) { const v = toRupees(inc[1], inc[2]); if (v) slots.annualIncome = monthly(inc[3]) ? v * 12 : v; }

  const exp = t.match(new RegExp(`\\b(?:expenses?|spend|spending)\\b${GAP}${AMOUNT}${PERIOD}`));
  if (exp) { const v = toRupees(exp[1], exp[2]); if (v) slots.monthlyExpenses = /year|annum/.test(exp[3] || '') ? Math.round(v / 12) : v; }

  const loan = t.match(new RegExp(`\\b(?:loans?|liabilit(?:y|ies))\\b${GAP}${AMOUNT}`));
  if (loan && loan[2]) { const v = toRupees(loan[1], loan[2]); if (v) slots.liabilities = v; }

  const cover = t.match(new RegExp(`\\b(?:existing|current)\\s+(?:life\\s+)?(?:cover|insurance|policy)\\b${GAP}${AMOUNT}`));
  if (cover) { const v = toRupees(cover[1], cover[2]); if (v) slots.existingCover = v; }

  return slots;
}

// Order matters: first match wins. English plus a few common Hinglish words.
const INTENTS = [
  ['opt_out', /\b(stop|unsubscribe|opt ?out|don'?t (?:message|contact)|do not (?:message|contact))\b/],
  ['advisor', /\b(advisor|adviser|agent|call (?:me|back)|callback|speak|talk to|baat)\b/],
  ['documents', /\b(documents?|docs?|upload|pan|photo|photograph|selfie|kyc|kagaz|dastavez)\b/],
  ['compare', /\b(compare|comparison|versus|vs|difference between|tulna)\b/],
  ['illustrations', /\b(illustrations?|projections?|benefit (?:table|illustration))\b/],
  ['plans', /\b(?:show|see|view|which|recommend|suggest|list)\b.*\b(?:plans?|polic(?:y|ies)|products?)\b|\bmy plans\b/],
  ['needs', /\b(how much|need|needs|calculate|analysis|analyse|analyze|gap|retire|retirement|education|protection|cover|zaroorat)\b/],
  ['plans', /\b(plans?|recommend|suggest|polic(?:y|ies)|products?|ulip|term|annuity|pension)\b/],
];

export const VOICE_MENU_ID = { needs: 'menu:needs', plans: 'menu:plans', compare: 'menu:compare', illustrations: 'menu:bis', advisor: 'menu:advisor', documents: 'menu:docs' };

/** @returns {VoiceResult} */
export function interpretVoice(transcript = '') {
  const t = transcript.toLowerCase().trim();
  if (!t) return { intent: null, confidence: 0, slots: {} };
  const slots = extractSlots(t);
  const hit = INTENTS.find(([, re]) => re.test(t));
  if (hit) return { intent: hit[0], confidence: 0.9, slots };
  // Someone describing themselves ("I'm 34, earn 24 lakh, two kids") wants a needs analysis.
  if (Object.keys(slots).length >= 2) return { intent: 'needs', confidence: 0.7, slots };
  return { intent: null, confidence: 0, slots };
}

const SLOT_LABEL = {
  age: (v) => `age ${v}`, annualIncome: (v) => `income ${inr(v)} a year`, dependents: (v) => `${v} dependent${v === 1 ? '' : 's'}`,
  youngestChildAge: (v) => `youngest child ${v}`, monthlyExpenses: (v) => `expenses ${inr(v)} a month`,
  liabilities: (v) => `loans ${inr(v)}`, existingCover: (v) => `existing cover ${inr(v)}`,
};
export const describeSlots = (slots) => Object.entries(slots).map(([k, v]) => SLOT_LABEL[k]?.(v)).filter(Boolean).join(' · ');
