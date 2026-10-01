import React, { useState } from 'react';
import { clock } from '../time.js';

/** Render WhatsApp text formatting: *bold*, _italic_, ~strike~, newlines. */
export function WaText({ text = '' }) {
  const lines = String(text).split('\n');
  return lines.map((line, i) => (
    <React.Fragment key={i}>
      {formatLine(line)}
      {i < lines.length - 1 && <br />}
    </React.Fragment>
  ));
}
function formatLine(line) {
  const parts = [];
  const re = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const inner = m[0].slice(1, -1);
    if (m[0][0] === '*') parts.push(<strong key={k++}>{inner}</strong>);
    else if (m[0][0] === '_') parts.push(<em key={k++}>{inner}</em>);
    else parts.push(<s key={k++}>{inner}</s>);
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function Meta({ msg, showPayload, onTogglePayload }) {
  const m = msg.meta || {};
  return (
    <div className="bubble-meta">
      {m.template && <span className="tag" title="Sent as an approved WhatsApp template">Template · {m.template}</span>}
      {m.sessionWindow === 'closed' && <span className="tag tag-warn" title="Outside the 24-hour customer service window">24h window closed</span>}
      {m.cloudApiPreview && (
        <button className="payload-toggle" onClick={onTogglePayload} aria-expanded={showPayload}>
          {showPayload ? 'Hide payload' : 'API payload'}
        </button>
      )}
      <time>{clock(msg.ts)}</time>
    </div>
  );
}

export default function Message({ msg, onReply, onOpenList, onOpenFlow }) {
  const [showPayload, setShowPayload] = useState(false);
  const mine = msg.dir === 'in'; // sent by the phone's owner

  if (mine) {
    const i = msg.inbound || {};
    return (
      <div className="row row-mine">
        <div className="bubble bubble-mine">
          {i.type === 'flow_submit' ? (
            <>
              <div className="flow-done">Form submitted</div>
              <div className="flow-summary">{summarise(i.data)}</div>
            </>
          ) : i.type === 'audio' ? (
            <div className="voice">
              {i.url && <audio controls preload="metadata" src={i.url} aria-label="Voice note" />}
              {i.transcript && <div className="voice-transcript"><span className="tag">Transcript</span> {i.transcript}</div>}
            </div>
          ) : i.type === 'image' ? (
            <>
              {i.url && <a href={i.url} target="_blank" rel="noreferrer"><img className="media-img" src={i.url} alt={i.caption || 'Photo sent'} /></a>}
              {i.caption && <WaText text={i.caption} />}
            </>
          ) : i.type === 'document' ? (
            <a className="doc" href={i.url} target="_blank" rel="noreferrer">
              <span className="doc-icon" aria-hidden>{(i.mime || '').includes('pdf') ? 'PDF' : 'FILE'}</span>
              <span className="doc-body"><span className="doc-name">{i.filename || 'Document'}</span><span className="doc-sub">{i.size ? `${Math.round(i.size / 1024)} KB` : 'Tap to open'}</span></span>
            </a>
          ) : (
            <WaText text={msg.text} />
          )}
          <div className="bubble-meta"><time>{clock(msg.ts)}</time><span className="ticks" aria-label="Read">✓✓</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`row row-theirs ${msg.meta?.notification ? 'is-notification' : ''}`}>
      <div className="bubble bubble-theirs">
        {msg.type === 'document' && (
          <a className="doc" href={msg.document.url} target="_blank" rel="noreferrer">
            <span className="doc-icon" aria-hidden>PDF</span>
            <span className="doc-body">
              <span className="doc-name">{msg.document.filename}</span>
              <span className="doc-sub">Indicative illustration · tap to open</span>
            </span>
          </a>
        )}
        {msg.text && <div className="bubble-text"><WaText text={msg.text} /></div>}
        <Meta msg={msg} showPayload={showPayload} onTogglePayload={() => setShowPayload((v) => !v)} />
        {showPayload && <pre className="payload">{JSON.stringify(msg.meta.cloudApiPreview, null, 2)}</pre>}
      </div>

      {msg.type === 'buttons' && (
        <div className="actions">
          {msg.buttons.map((b) => (
            <button key={b.id} className="action" onClick={() => onReply({ type: 'button_reply', id: b.id, title: b.title })}>{b.title}</button>
          ))}
        </div>
      )}
      {msg.type === 'list' && (
        <div className="actions">
          <button className="action" onClick={() => onOpenList(msg)}><span aria-hidden>☰</span> {msg.list.button}</button>
        </div>
      )}
      {msg.type === 'flow' && (
        <div className="actions">
          <button className="action" onClick={() => onOpenFlow(msg)}>{msg.flow.cta}</button>
        </div>
      )}
    </div>
  );
}

function summarise(data = {}) {
  return Object.entries(data)
    .filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join(' · ');
}
