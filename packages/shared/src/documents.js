/**
 * Application documents the customer can send over WhatsApp.
 * Required types gate the "all documents received" notification, not the stage:
 * the proposal stage is still moved by the customer or the advisor.
 */
export const DOC_TYPES = [
  { id: 'pan', label: 'PAN card', short: 'PAN card', required: true, accept: ['image', 'pdf'], keywords: /\b(pan|permanent account)\b/i, hint: 'a clear photo of the front, all four corners visible' },
  { id: 'photo', label: 'Passport-size photo', short: 'photo', required: true, accept: ['image'], keywords: /\b(photo|photograph|selfie|passport[- ]?size)\b/i, hint: 'a recent photo, face clearly visible, plain background' },
  { id: 'address_proof', label: 'Address proof', short: 'address proof', required: false, accept: ['image', 'pdf'], keywords: /\b(address|aadhaar|aadhar|passport|utility|bill)\b/i, hint: 'Aadhaar (masked) or passport, with your current address' },
  { id: 'bank_proof', label: 'Bank proof', short: 'bank proof', required: false, accept: ['image', 'pdf'], keywords: /\b(cheque|check|bank|passbook|statement)\b/i, hint: 'a cancelled cheque or the first page of your passbook' },
];

export const DOC_STATUS = { received: 'Received', accepted: 'Accepted', rejected: 'Rejected', superseded: 'Replaced' };
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // WhatsApp images are capped at 5 MB
export const getDocType = (id) => DOC_TYPES.find((d) => d.id === id) || null;

const kindOf = (mime = '') => (mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : null);

/** Guess the document type from a caption or filename. Returns an id or null. */
export function classifyDocument(...hints) {
  const t = hints.filter(Boolean).join(' ');
  if (!t) return null;
  const hit = DOC_TYPES.filter((d) => d.keywords.test(t));
  return hit.length === 1 ? hit[0].id : null; // ambiguous means ask
}

/** @returns {{ok: true} | {ok: false, error: string}} */
export function validateUpload(typeId, { mime, size }) {
  const kind = kindOf(mime);
  if (!kind) return { ok: false, error: 'Please send a photo (JPG or PNG) or a PDF.' };
  const type = getDocType(typeId);
  if (type && !type.accept.includes(kind)) return { ok: false, error: `${type.label} needs ${type.accept.includes('image') ? 'a photo' : 'a PDF'}, not a ${kind === 'pdf' ? 'PDF' : 'photo'}.` };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: 'That file is larger than 5 MB. Please send a smaller one.' };
  return { ok: true };
}

/** Latest usable document per type (superseded and rejected ones don't count as received). */
export function currentDocs(docs = []) {
  const by = {};
  for (const d of docs) if (d.status !== 'superseded') by[d.type] = d;
  return by;
}

export function checklist(docs) {
  const by = currentDocs(docs);
  const mark = (d) => { const x = by[d.id]; return !x ? '⬜' : x.status === 'rejected' ? '❌' : '✅'; };
  const lines = DOC_TYPES.map((d) => `${mark(d)} ${d.label}${d.required ? '' : ' _(optional)_'}`);
  const missing = DOC_TYPES.filter((d) => d.required && (!by[d.id] || by[d.id].status === 'rejected'));
  return { text: lines.join('\n'), missing, complete: missing.length === 0 };
}
