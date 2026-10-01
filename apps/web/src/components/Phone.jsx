import React, { useEffect, useRef, useState } from 'react';
import Message from './Message.jsx';
import { ListSheet, FlowSheet } from './Sheets.jsx';
import { useVoiceRecorder, fileToDataUrl } from '../voice.js';

/**
 * A WhatsApp-like phone. `owner` is who holds the phone; `contact` is who
 * they are chatting with (always the business number in this prototype).
 */
export default function Phone({ label, owner, contact, contactSub, messages, onSend, emptyHint, disabled, media = false }) {
  const [draft, setDraft] = useState('');
  const [list, setList] = useState(null);
  const [flow, setFlow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const scroller = useRef(null);
  const fileInput = useRef(null);
  const voice = useVoiceRecorder();

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async (inbound) => {
    setList(null); setFlow(null); setErr('');
    setBusy(true);
    try { await onSend(inbound); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const pickFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const caption = draft.trim();
    setDraft('');
    const dataUrl = await fileToDataUrl(f);
    send({ type: f.type.startsWith('image/') ? 'image' : 'document', dataUrl, filename: f.name, caption });
  };

  const sendVoice = async () => {
    const { dataUrl, durationSec, transcript } = voice.draft;
    voice.finish();
    await send({ type: 'audio', dataUrl, durationSec, transcript: transcript.trim() });
  };

  const submitText = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    send({ type: 'text', text: draft.trim() });
    setDraft('');
  };

  return (
    <section className="phone-wrap" aria-label={label}>
      <div className="phone-label">
        <span className="phone-owner">{label}</span>
        <span className="phone-owner-sub">{owner}</span>
      </div>
      <div className="phone">
        <header className="wa-head">
          <span className="wa-avatar" aria-hidden>{contact.slice(0, 1)}</span>
          <span className="wa-contact">
            <span className="wa-name">{contact} <span className="verified" title="Business account">✔</span></span>
            <span className="wa-sub">{contactSub}</span>
          </span>
        </header>

        <div className="wa-chat" ref={scroller}>
          <div className="wa-encryption">Messages are shown in a simulator. No real WhatsApp messages are sent.</div>
          {!messages.length && <div className="wa-empty">{emptyHint}</div>}
          {messages.map((m) => (
            <Message key={m.id} msg={m} onReply={send} onOpenList={setList} onOpenFlow={setFlow} />
          ))}
          {busy && <div className="typing" aria-live="polite"><span /><span /><span /></div>}
        </div>

        {err && <div className="wa-error" role="alert">{err}</div>}

        {media && voice.phase === 'review' && voice.draft && (
          <div className="voice-review">
            {voice.draft.dataUrl && <audio controls src={voice.draft.dataUrl} aria-label="Your recording" />}
            <label className="voice-label">
              Transcript (edit if it got a word wrong)
              <textarea rows={2} value={voice.draft.transcript} onChange={(e) => voice.setTranscript(e.target.value)} placeholder="e.g. How much life cover do I need?" />
            </label>
            {voice.draft.note && <p className="voice-note">{voice.draft.note}</p>}
            <div className="voice-actions">
              <button type="button" className="btn btn-quiet" onClick={voice.discard}>Discard</button>
              <button type="button" className="btn" disabled={busy || !voice.draft.transcript.trim()} onClick={sendVoice}>Send voice note</button>
            </div>
          </div>
        )}

        <form className="wa-composer" onSubmit={submitText}>
          {media && (
            <>
              <button type="button" className="wa-attach" aria-label="Attach a photo or PDF" title="Attach a photo or PDF" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>📎</button>
              <input ref={fileInput} type="file" accept="image/*,application/pdf" hidden onChange={pickFile} />
            </>
          )}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={disabled ? 'Select a lead first' : voice.phase === 'recording' ? `Recording… ${voice.seconds}s` : 'Message'}
            aria-label="Type a message"
            disabled={disabled || voice.phase === 'recording'}
          />
          {media && !draft.trim() ? (
            voice.phase === 'recording' ? (
              <button type="button" className="wa-send wa-rec" aria-label="Stop recording" onClick={voice.stop}>■</button>
            ) : (
              <button type="button" className="wa-send" aria-label="Record a voice note" title="Record a voice note" disabled={disabled || busy || voice.phase === 'review'} onClick={voice.start}>🎤</button>
            )
          ) : (
            <button type="submit" className="wa-send" aria-label="Send" disabled={disabled || !draft.trim()}>➤</button>
          )}
        </form>

        {list && <ListSheet msg={list} onClose={() => setList(null)} onPick={send} />}
        {flow && <FlowSheet msg={flow} onClose={() => setFlow(null)} onSubmit={send} />}
      </div>
    </section>
  );
}
