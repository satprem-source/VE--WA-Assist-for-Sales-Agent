/** Thin client for the mock API (proxied by Vite at /api). */
const json = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
};
const post = (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }).then(json);

export const api = {
  health: () => fetch('/api/health').then(json),
  agent: (id) => fetch(`/api/agents/${id}`).then(json),
  leads: (agentId) => fetch(`/api/leads${agentId ? `?agentId=${agentId}` : ''}`).then(json),
  lead: (id) => fetch(`/api/leads/${id}`).then(json),
  patchLead: (id, data) => fetch(`/api/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json),
  reviewDocument: (id, data) => fetch(`/api/documents/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json),
  conversation: (key) => fetch(`/api/conversations/${key}`).then(json),
  send: (key, inbound) => post(`/api/conversations/${key}/inbound`, { inbound }),
  advanceClock: (hours) => post('/api/demo/clock', { hours }),
  reset: () => post('/api/demo/reset'),
};

/** Subscribe to server-sent events. Returns an unsubscribe function. */
export function subscribe(handlers) {
  const es = new EventSource('/api/stream');
  for (const [event, fn] of Object.entries(handlers)) es.addEventListener(event, (e) => fn(JSON.parse(e.data)));
  return () => es.close();
}
