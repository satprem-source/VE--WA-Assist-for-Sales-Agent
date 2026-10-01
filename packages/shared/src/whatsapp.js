/**
 * WhatsApp Cloud API adapter.
 *
 * Internal message shape (used by bots + UI):
 *   { type: 'text', text }
 *   { type: 'buttons', text, buttons: [{ id, title }] }              // max 3, title ≤ 20 chars
 *   { type: 'list', text, list: { button, sections: [{ title, rows: [{ id, title, description }] }] } } // ≤ 10 rows
 *   { type: 'flow', text, flow: { id, title, cta, fields: [...], prefill } }
 *   { type: 'document', text, document: { illustrationId, filename, url } }
 *   { type: 'template', template: { name, params }, text }            // outside 24h window
 *
 * Inbound replies:
 *   { type: 'text', text } | { type: 'button_reply', id, title } |
 *   { type: 'list_reply', id, title } | { type: 'flow_submit', flowId, data } |
 *   { type: 'image' | 'document', mediaId, mime, filename, size, caption, url } |
 *   { type: 'audio', mediaId, mime, durationSec, transcript, url }   // voice note
 *
 * toCloudApiPayload() shows the exact JSON a production sender would POST to
 * https://graph.facebook.com/v{N}/{PHONE_NUMBER_ID}/messages. The UI exposes it
 * per message ("API payload") so engineers can see the mapping.
 */
export const LIMITS = { buttons: 3, buttonTitle: 20, listRows: 10, rowTitle: 24, rowDescription: 72, body: 1024 };

const clip = (s = '', n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function toCloudApiPayload(msg, to = '91XXXXXXXXXX') {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (msg.type) {
    case 'text':
      return { ...base, type: 'text', text: { body: clip(msg.text, 4096), preview_url: false } };
    case 'buttons':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'button', body: { text: clip(msg.text, LIMITS.body) },
          action: { buttons: msg.buttons.slice(0, LIMITS.buttons).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, LIMITS.buttonTitle) } })) },
        },
      };
    case 'list':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'list', body: { text: clip(msg.text, LIMITS.body) },
          action: {
            button: clip(msg.list.button, LIMITS.buttonTitle),
            sections: msg.list.sections.map((s) => ({
              title: clip(s.title, 24),
              rows: s.rows.map((r) => ({ id: r.id, title: clip(r.title, LIMITS.rowTitle), description: clip(r.description || '', LIMITS.rowDescription) })),
            })),
          },
        },
      };
    case 'flow':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'flow', body: { text: clip(msg.text, LIMITS.body) },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3', flow_id: `<FLOW_ID:${msg.flow.id}>`, flow_cta: clip(msg.flow.cta, 20),
              flow_action: 'navigate', flow_action_payload: { screen: 'MAIN', data: msg.flow.prefill || {} },
            },
          },
        },
      };
    case 'document':
      return { ...base, type: 'document', document: { link: msg.document.url, filename: msg.document.filename, caption: clip(msg.text || '', 1024) } };
    case 'template':
      return {
        ...base, type: 'template',
        template: { name: msg.template.name, language: { code: 'en' }, components: [{ type: 'body', parameters: (msg.template.params || []).map((t) => ({ type: 'text', text: String(t) })) }] },
      };
    default:
      return { ...base, type: 'unsupported', internal: msg };
  }
}

/** Translate a Cloud API webhook message into our inbound shape. */
export function fromCloudApiWebhook(m) {
  if (m.type === 'text') return { type: 'text', text: m.text.body };
  if (m.type === 'interactive') {
    const i = m.interactive;
    if (i.type === 'button_reply') return { type: 'button_reply', id: i.button_reply.id, title: i.button_reply.title };
    if (i.type === 'list_reply') return { type: 'list_reply', id: i.list_reply.id, title: i.list_reply.title };
    if (i.type === 'nfm_reply') {
      const data = JSON.parse(i.nfm_reply.response_json || '{}');
      return { type: 'flow_submit', flowId: data.flow_token || data.flowId, data };
    }
  }
  // Media: the Cloud API sends a media id. The file is fetched separately (GET /{media-id}, then the returned URL with the bearer token).
  if (m.type === 'image') return { type: 'image', mediaId: m.image.id, mime: m.image.mime_type, caption: m.image.caption || '', waMediaId: m.image.id };
  if (m.type === 'document') return { type: 'document', mediaId: m.document.id, mime: m.document.mime_type, filename: m.document.filename, caption: m.document.caption || '', waMediaId: m.document.id };
  if (m.type === 'audio') return { type: 'audio', mediaId: m.audio.id, mime: m.audio.mime_type, waMediaId: m.audio.id, voice: !!m.audio.voice };
  if (m.type === 'button') return { type: 'button_reply', id: m.button.payload, title: m.button.text };
  return { type: 'text', text: '' };
}
