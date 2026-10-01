import React, { useMemo, useState } from 'react';
import { STAGES, stageLabel, getProduct, inr, GOAL_LABELS, LOST_REASONS, CATEGORY_LABELS, DOC_TYPES, DOC_STATUS, getDocType, checklist } from '@nb/shared';
import { api } from '../api.js';
import { ago } from '../time.js';

export default function Dashboard({ leads, selectedId, onSelect, detail, nowMs, onPatch, flashIds }) {
  const [filter, setFilter] = useState('open');
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.key, leads.filter((l) => l.stage === s.key).length])), [leads]);
  const staleCount = leads.filter((l) => l.stale).length;

  const shown = leads.filter((l) =>
    filter === 'open' ? !['issued', 'lost'].includes(l.stage)
    : filter === 'stale' ? l.stale
    : filter === 'all' ? true
    : l.stage === filter);

  return (
    <section className="dash" aria-label="Lead dashboard">
      <header className="dash-head">
        <h2>Leads</h2>
        <p className="dash-sub">Updates live as WhatsApp conversations move.</p>
      </header>

      <nav className="funnel" aria-label="Filter by stage">
        <button className={`chip ${filter === 'open' ? 'is-on' : ''}`} onClick={() => setFilter('open')}>Open</button>
        <button className={`chip chip-warn ${filter === 'stale' ? 'is-on' : ''}`} onClick={() => setFilter('stale')}>Follow up <b>{staleCount}</b></button>
        {STAGES.map((s) => (
          <button key={s.key} className={`chip ${filter === s.key ? 'is-on' : ''}`} onClick={() => setFilter(s.key)}>
            {s.label} <b>{counts[s.key]}</b>
          </button>
        ))}
        <button className={`chip ${filter === 'all' ? 'is-on' : ''}`} onClick={() => setFilter('all')}>All</button>
      </nav>

      <ol className="lead-list">
        {shown.map((l) => (
          <li key={l.id}>
            <button className={`lead-row ${l.id === selectedId ? 'is-selected' : ''} ${flashIds.has(l.id) ? 'is-flash' : ''}`} onClick={() => onSelect(l.id)}>
              <span className="lead-name">{l.name}</span>
              <span className={`stage stage-${l.stage}`}>{stageLabel(l.stage)}</span>
              <span className="lead-when">{ago(l.lastActivityAt, nowMs)}</span>
              {l.stale && <span className="stale" title={l.stale.reason}>Follow up · {l.stale.hoursIdle}h idle</span>}
            </button>
          </li>
        ))}
        {!shown.length && <li className="empty">No leads here. Add one from the agent phone: send “Hi”, then Add a lead.</li>}
      </ol>

      {detail ? <LeadDetail lead={detail} nowMs={nowMs} onPatch={onPatch} /> : <div className="detail-empty">Select a lead to see its needs, illustrations and history.</div>}
    </section>
  );
}

function LeadDetail({ lead, nowMs, onPatch }) {
  const [tab, setTab] = useState('overview');
  const g = lead.needs?.gaps || {};

  const changeStage = (stage) => {
    if (stage === 'lost') {
      const reason = window.prompt(`Why was it lost?\n${LOST_REASONS.join(', ')}`, LOST_REASONS[0]);
      if (!reason) return;
      onPatch(lead.id, { stage, lostReason: reason });
    } else onPatch(lead.id, { stage });
  };

  return (
    <article className="detail" aria-label={`Lead ${lead.name}`}>
      <header className="detail-head">
        <div>
          <h3>{lead.name}</h3>
          <p className="muted">{lead.id} · {lead.mobile} · {lead.source}</p>
        </div>
        <label className="stage-select">
          <span className="sr-only">Stage</span>
          <select value={lead.stage} onChange={(e) => changeStage(e.target.value)}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </header>

      {lead.stale && <p className="banner-warn">{lead.stale.reason}. Idle {lead.stale.hoursIdle}h. Send a reminder from the agent phone.</p>}
      <p className="consent">{lead.consent?.given ? `Opted in on WhatsApp ${ago(lead.consent.at, nowMs)}` : 'Not opted in yet. The customer only receives the opt-in message until they agree.'}</p>

      <div className="tabs" role="tablist">
        {['overview', 'illustrations', 'documents', 'timeline'].map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'is-on' : ''}`} onClick={() => setTab(t)}>
            {t === 'overview' ? 'Needs' : t === 'illustrations' ? `Illustrations (${lead.illustrations?.length || 0})` : t === 'documents' ? `Documents (${docCount(lead)}/${DOC_TYPES.filter((d) => d.required).length})` : 'Timeline'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="tab-body">
          {!lead.needs ? (
            <p className="muted">Needs not captured yet.</p>
          ) : (
            <>
              <dl className="gaps">
                {g.protection && <Gap label="Protection gap" value={inr(g.protection.gap)} note={`Needs ${inr(g.protection.required)}, has ${inr(g.protection.existing)}`} />}
                {g.child_education && <Gap label="Education corpus" value={inr(g.child_education.corpusRequired)} note={`In ${g.child_education.yearsToGoal} years`} />}
                {g.retirement && <Gap label="Retirement corpus" value={inr(g.retirement.corpusRequired)} note={`In ${g.retirement.yearsToRetire} years`} />}
                {g.health && <Gap label="Health cover" value={inr(g.health.recommendedCover)} note="For the family" />}
              </dl>
              <p className="muted small">Goals: {lead.goals.map((x) => GOAL_LABELS[x]).join(', ')} · Risk comfort: {lead.risk}</p>
              <h4 className="subhead">Recommended plans</h4>
              <ul className="plans">
                {lead.recommendedProductIds.map((id) => {
                  const p = getProduct(id);
                  return <li key={id}><span>{p.name}</span><span className="muted small">{CATEGORY_LABELS[p.category]} · {p.uin}</span></li>;
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'illustrations' && (
        <div className="tab-body">
          {!lead.illustrations?.length ? <p className="muted">No illustrations yet.</p> : (
            <table className="bi-table">
              <thead><tr><th>Plan</th><th>Premium</th><th>Status</th><th /></tr></thead>
              <tbody>
                {lead.illustrations.slice().reverse().map((b) => (
                  <tr key={b.illustrationId}>
                    <td><b>{b.productName}</b><br /><span className="muted small">{b.illustrationId} · {b.uin}</span></td>
                    <td>{inr(b.premium.modal, { compact: false })}<br /><span className="muted small">{b.premium.frequency}</span></td>
                    <td>{b.acknowledgedAt ? 'Reviewed' : b.sharedAt ? 'Shared' : 'Draft'}<br /><span className="muted small">{ago(b.acknowledgedAt || b.sharedAt || b.generatedAt, nowMs)}</span></td>
                    <td><a href={`/api/illustrations/${b.illustrationId}.pdf`} target="_blank" rel="noreferrer">Open PDF</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'documents' && <DocumentsTab lead={lead} nowMs={nowMs} />}

      {tab === 'timeline' && (
        <ol className="timeline tab-body">
          {lead.timeline.slice().reverse().map((t, i) => (
            <li key={i} className={`tl tl-${t.type}`}>
              <span className="tl-text">{t.text}</span>
              <span className="muted small">{ago(t.ts, nowMs)}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

const docCount = (lead) => DOC_TYPES.filter((d) => d.required).length - checklist(lead.documents || []).missing.length;

function DocumentsTab({ lead, nowMs }) {
  const [err, setErr] = useState('');
  const docs = lead.documents || [];
  const { missing, complete } = checklist(docs);
  const live = docs.filter((d) => d.status !== 'superseded');

  const review = async (doc, status) => {
    let reason;
    if (status === 'rejected') {
      reason = window.prompt('Why is it being rejected? The customer is asked to send it again.', 'Not clear enough');
      if (!reason) return;
    }
    try { await api.reviewDocument(doc.id, { status, reason }); setErr(''); } catch (e) { setErr(e.message); }
  };

  return (
    <div className="tab-body">
      <p className={complete ? 'docs-ok' : 'muted'}>
        {complete ? 'All required documents received.' : `Still needed: ${missing.map((d) => d.label).join(', ')}.`}
      </p>
      {err && <p className="banner-warn" role="alert">{err}</p>}
      {!live.length ? <p className="muted">Nothing uploaded yet. The customer can send files from the 📎 button, or choose Upload documents in the menu.</p> : (
        <ul className="doc-cards">
          {live.map((d) => (
            <li key={d.id} className="doc-card">
              {d.url && d.mime?.startsWith('image/')
                ? <a href={d.url} target="_blank" rel="noreferrer"><img src={d.url} alt={getDocType(d.type)?.label} /></a>
                : <a className="doc-thumb" href={d.url || undefined} target="_blank" rel="noreferrer">{d.mime?.includes('pdf') ? 'PDF' : 'FILE'}</a>}
              <div className="doc-card-body">
                <b>{getDocType(d.type)?.label}</b>
                <span className="muted small">{d.id} · {d.size ? `${Math.round(d.size / 1024)} KB · ` : ''}{ago(d.uploadedAt, nowMs)}</span>
                <span className={`doc-status doc-${d.status}`}>{DOC_STATUS[d.status]}{d.reason ? `: ${d.reason}` : ''}</span>
                {d.status === 'received' && (
                  <span className="doc-btns">
                    <button className="btn" onClick={() => review(d, 'accepted')}>Accept</button>
                    <button className="btn btn-quiet" onClick={() => review(d, 'rejected')}>Reject</button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Gap({ label, value, note }) {
  return (
    <div className="gap">
      <dt>{label}</dt>
      <dd><span className="gap-value">{value}</span><span className="muted small">{note}</span></dd>
    </div>
  );
}
