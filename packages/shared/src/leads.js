/**
 * Lead pipeline: stages, transitions, stale rules.
 */
export const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'needs_done', label: 'Needs analysed' },
  { key: 'quote_shared', label: 'Plans compared' },
  { key: 'bi_shared', label: 'Illustration shared' },
  { key: 'proposal', label: 'Proposal started' },
  { key: 'issued', label: 'Issued' },
  { key: 'lost', label: 'Lost' },
];
export const STAGE_ORDER = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));
export const stageLabel = (k) => STAGES.find((s) => s.key === k)?.label || k;

export const LOST_REASONS = ['Not interested', 'Bought elsewhere', 'Budget', 'Not reachable', 'Not eligible'];
export const LEAD_SOURCES = ['Walk-in', 'Referral', 'Existing customer', 'Campaign', 'Bank branch', 'Website'];

/** Only move forward automatically; manual moves (agent) can go anywhere. */
export function advanceStage(current, target) {
  if (current === 'lost' || current === 'issued') return current;
  return STAGE_ORDER[target] > STAGE_ORDER[current] ? target : current;
}

const H = 3600 * 1000;
/** Stale rules (hours without customer activity, per stage). Tune freely. */
export const STALE_RULES = {
  new: { hours: 24, reason: 'No response to the first message in 24h' },
  needs_done: { hours: 72, reason: 'Needs analysed, no plan shared in 72h' },
  quote_shared: { hours: 48, reason: 'Plans compared, no illustration in 48h' },
  bi_shared: { hours: 48, reason: 'Illustration shared, no response in 48h' },
  proposal: { hours: 72, reason: 'Proposal pending for 72h' },
};

export function staleness(lead, now = Date.now()) {
  const rule = STALE_RULES[lead.stage];
  if (!rule) return null;
  const last = new Date(lead.lastActivityAt || lead.updatedAt || lead.createdAt).getTime();
  const hours = (now - last) / H;
  return hours >= rule.hours ? { stale: true, hoursIdle: Math.floor(hours), reason: rule.reason } : null;
}
