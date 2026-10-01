import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, subscribe } from './api.js';
import Phone from './components/Phone.jsx';
import Dashboard from './components/Dashboard.jsx';

const AGENT_ID = 'agent-1';
const AGENT_KEY = `agent:${AGENT_ID}`;
const BUSINESS_NAME = 'Insurance Assist';
const AGENT_BOT_NAME = 'Sales Assist';

export default function App() {
  const [agent, setAgent] = useState(null);
  const [leads, setLeads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [convs, setConvs] = useState({});
  const [offsetMs, setOffsetMs] = useState(0); // server clock − browser clock
  const [tick, setTick] = useState(Date.now());
  const [flashIds, setFlashIds] = useState(new Set());
  const [error, setError] = useState('');
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  const nowMs = tick + offsetMs;

  const loadAll = useCallback(async () => {
    try {
      const [h, a, ls, agentConv] = await Promise.all([api.health(), api.agent(AGENT_ID), api.leads(AGENT_ID), api.conversation(AGENT_KEY)]);
      setOffsetMs(new Date(h.now).getTime() - Date.now());
      setAgent(a);
      setLeads(ls);
      setConvs({ [AGENT_KEY]: agentConv });
      setError('');
      const keep = ls.find((l) => l.id === selectedRef.current) ? selectedRef.current : ls[0]?.id;
      setSelectedId(keep || null);
    } catch {
      setError('Cannot reach the mock API on port 4000. Start it with: npm run dev');
    }
  }, []);

  // Selected lead: load detail + customer conversation.
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    api.lead(selectedId).then(setDetail).catch(() => setDetail(null));
    api.conversation(`customer:${selectedId}`).then((msgs) => setConvs((c) => ({ ...c, [`customer:${selectedId}`]: msgs })));
  }, [selectedId]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 15000); return () => clearInterval(t); }, []);

  // Realtime updates.
  useEffect(() => subscribe({
    message: ({ key, message }) => setConvs((c) => {
      const list = c[key] || [];
      if (list.some((m) => m.id === message.id)) return c;
      return { ...c, [key]: [...list, message] };
    }),
    lead: () => {
      api.leads(AGENT_ID).then((ls) => {
        setLeads((prev) => {
          const changed = ls.filter((l) => { const p = prev.find((x) => x.id === l.id); return !p || p.updatedAt !== l.updatedAt; }).map((l) => l.id);
          if (changed.length) {
            setFlashIds(new Set(changed));
            setTimeout(() => setFlashIds(new Set()), 1400);
          }
          return ls;
        });
      });
      if (selectedRef.current) api.lead(selectedRef.current).then(setDetail).catch(() => {});
    },
    clock: ({ now }) => {
      setOffsetMs(new Date(now).getTime() - Date.now());
      setTick(Date.now());
      api.leads(AGENT_ID).then(setLeads);
      if (selectedRef.current) api.lead(selectedRef.current).then(setDetail).catch(() => {});
    },
    reset: () => loadAll(),
  }), [loadAll]);

  const sendAs = (key) => (inbound) => api.send(key, inbound);
  const patchLead = async (id, data) => { await api.patchLead(id, data); };

  const customerKey = selectedId ? `customer:${selectedId}` : null;
  const selectedLead = leads.find((l) => l.id === selectedId);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>New business on WhatsApp</h1>
          <p>Prototype · Tata AIA catalogue · all values indicative</p>
        </div>
        <div className="controls">
          <label className="control">
            <span>Customer phone</span>
            <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value)}>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.id})</option>)}
            </select>
          </label>
          <span className="clock" title="Demo clock (server time)">
            {new Date(nowMs).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
          <button className="btn" onClick={() => api.advanceClock(24)} title="Move the demo clock forward to see follow-up flags and the 24h window">+24 hours</button>
          <button className="btn btn-quiet" onClick={() => api.reset()}>Reset demo</button>
        </div>
      </header>

      {error && <p className="app-error" role="alert">{error}</p>}

      <main className="stage-grid">
        <Phone
          label="Customer"
          owner={selectedLead ? `${selectedLead.name} · +91 ${selectedLead.mobile}` : 'No lead selected'}
          contact={BUSINESS_NAME}
          contactSub="Business account"
          messages={(customerKey && convs[customerKey]) || []}
          onSend={customerKey ? sendAs(customerKey) : async () => {}}
          disabled={!customerKey}
          media
          emptyHint="No messages yet. From the agent phone, open this lead and choose “Send needs form”."
        />
        <Phone
          label="Agent"
          owner={agent ? `${agent.name} · ${agent.channel}` : ''}
          contact={AGENT_BOT_NAME}
          contactSub="Business account · for advisors"
          messages={convs[AGENT_KEY] || []}
          onSend={sendAs(AGENT_KEY)}
          emptyHint="Send “Hi” to open the menu."
        />
        <Dashboard leads={leads} selectedId={selectedId} onSelect={setSelectedId} detail={detail} nowMs={nowMs} onPatch={patchLead} flashIds={flashIds} />
      </main>
    </div>
  );
}
