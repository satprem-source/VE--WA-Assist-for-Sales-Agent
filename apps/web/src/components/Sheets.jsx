import React, { useState } from 'react';

/** WhatsApp list message picker. */
export function ListSheet({ msg, onClose, onPick }) {
  const [picked, setPicked] = useState(null);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={msg.list.button} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
          <h3>{msg.list.button}</h3>
        </header>
        <div className="sheet-body">
          {msg.list.sections.map((s) => (
            <section key={s.title} className="list-section">
              <h4>{s.title}</h4>
              {s.rows.map((r) => (
                <label key={r.id} className="list-row">
                  <span>
                    <span className="list-title">{r.title}</span>
                    {r.description && <span className="list-desc">{r.description}</span>}
                  </span>
                  <input type="radio" name="list" checked={picked?.id === r.id} onChange={() => setPicked(r)} />
                </label>
              ))}
            </section>
          ))}
        </div>
        <footer className="sheet-foot">
          <button className="send-btn" disabled={!picked} onClick={() => onPick({ type: 'list_reply', id: picked.id, title: picked.title })}>Send</button>
        </footer>
      </div>
    </div>
  );
}

/** WhatsApp Flow (form) screen. Field types: number, text, select, toggle, checkbox, radio. */
export function FlowSheet({ msg, onClose, onSubmit }) {
  const { flow } = msg;
  const [values, setValues] = useState(() => ({ ...(flow.prefill || {}) }));
  const [error, setError] = useState('');
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    const missing = flow.fields.filter((f) => f.required && (values[f.name] === undefined || values[f.name] === '' || (Array.isArray(values[f.name]) && !values[f.name].length)));
    if (missing.length) return setError(`Fill in: ${missing.map((f) => f.label).join(', ')}`);
    onSubmit({ type: 'flow_submit', flowId: flow.id, data: values });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet sheet-tall" role="dialog" aria-label={flow.title} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header className="sheet-head">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
          <h3>{flow.title}</h3>
        </header>
        <div className="sheet-body flow-body">
          {flow.fields.map((f) => <Field key={f.name} f={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />)}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer className="sheet-foot">
          <button className="send-btn" type="submit">{flow.cta === 'Start' ? 'Continue' : 'Submit'}</button>
          <p className="flow-note">Managed by the business. Learn more</p>
        </footer>
      </form>
    </div>
  );
}

function Field({ f, value, onChange }) {
  const id = `f-${f.name}`;
  if (f.type === 'toggle') {
    return (
      <label className="field field-toggle" htmlFor={id}>
        <span>{f.label}</span>
        <input id={id} type="checkbox" checked={value === true || value === 'true'} onChange={(e) => onChange(e.target.checked)} />
      </label>
    );
  }
  if (f.type === 'select') {
    return (
      <label className="field" htmlFor={id}>
        <span>{f.label}</span>
        <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  if (f.type === 'checkbox') {
    const arr = Array.isArray(value) ? value : [];
    return (
      <fieldset className="field">
        <legend>{f.label}</legend>
        {f.options.map((o) => (
          <label key={o.value} className="choice">
            <input type="checkbox" checked={arr.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  if (f.type === 'radio') {
    return (
      <fieldset className="field">
        <legend>{f.label}</legend>
        {f.options.map((o) => (
          <label key={o.value} className="choice">
            <input type="radio" name={f.name} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <label className="field" htmlFor={id}>
      <span>{f.label}</span>
      <input id={id} type={f.type === 'number' ? 'number' : 'text'} inputMode={f.type === 'number' ? 'numeric' : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
