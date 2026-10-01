import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCustomerInbound } from '@nb/shared';
import { db, seed, nextId } from '../src/store.js';
import { services } from '../src/services.js';

const cust = (id, inbound) => handleCustomerInbound(id, inbound, services);
const optedIn = () => { seed(); const l = Object.values(db.leads).find((x) => x.name === 'Anjali Rao'); return l.id; };
const file = (over = {}) => {
  const mediaId = nextId.media();
  return { type: 'image', mediaId, mime: 'image/jpeg', size: 40000, url: `/api/media/${mediaId}`, caption: '', ...over };
};

test('documents: PAN then photo via the checklist, agent notified, completeness reached', async () => {
  const id = optedIn();
  const menu = await cust(id, { type: 'list_reply', id: 'menu:docs' });
  assert.equal(menu[0].type, 'list');
  assert.match(menu[0].text, /⬜ PAN card/);

  const ask = await cust(id, { type: 'list_reply', id: 'docs:ask:pan' });
  assert.match(ask[0].text, /PAN card/);
  assert.equal(db.leads[id].awaitingDoc, 'pan');

  const r1 = await cust(id, file());
  assert.match(r1[0].text, /Got your \*PAN card\*/);
  assert.equal(db.leads[id].awaitingDoc, null);
  assert.match(r1[0].text, /Next: \*Passport-size photo\*/);

  const r2 = await cust(id, file({ caption: 'my photo' })); // classified from the caption, no prompt needed
  assert.match(r2[0].text, /Everything required is in/);

  const docs = await services.listDocuments(id);
  assert.deepEqual(docs.map((d) => d.type).sort(), ['pan', 'photo']);
  const notes = db.conversations['agent:agent-1'].filter((m) => m.meta?.notification && /sent their/.test(m.text));
  assert.equal(notes.length, 2);
  assert.match(notes[1].text, /All required documents are in/);
});

test('documents: an unlabelled file asks which type, then files it', async () => {
  const id = optedIn();
  const r = await cust(id, file());
  assert.equal(r[0].type, 'list');
  assert.match(r[0].text, /Which document is this/);
  assert.ok(db.leads[id].pendingMedia);
  const done = await cust(id, { type: 'list_reply', id: 'docs:tag:pan' });
  assert.match(done[0].text, /PAN card/);
  assert.equal(db.leads[id].pendingMedia, null);
});

test('documents: wrong kind or oversize is refused and nothing is stored', async () => {
  const id = optedIn();
  await cust(id, { type: 'list_reply', id: 'docs:ask:photo' });
  const pdf = await cust(id, file({ type: 'document', mime: 'application/pdf', filename: 'x.pdf' }));
  assert.match(pdf[0].text, /needs a photo/);
  const big = await cust(id, file({ size: 6 * 1024 * 1024 }));
  assert.match(big[0].text, /larger than 5 MB/);
  assert.equal((await services.listDocuments(id)).length, 0);
  assert.equal(db.leads[id].awaitingDoc, 'photo', 'still waiting for the photo');
});

test('documents: re-upload supersedes; a rejection asks the customer to resend', async () => {
  const id = optedIn();
  await cust(id, { type: 'list_reply', id: 'docs:ask:pan' });
  await cust(id, file());
  const [first] = await services.listDocuments(id);
  await services.reviewDocument(first.id, 'rejected', { reason: 'Blurry' });
  const out = db.conversations[`customer:${id}`].at(-1);
  assert.match(out.text, /could not accept.*PAN card.*Blurry/s);
  assert.equal(out.buttons[0].id, 'docs:ask:pan');

  await cust(id, { type: 'list_reply', id: 'docs:ask:pan' });
  await cust(id, file());
  const all = await services.listDocuments(id);
  assert.equal(all.find((d) => d.id === first.id).status, 'superseded');
  assert.equal(all.filter((d) => d.status === 'received').length, 1);
});

test('documents need consent first', async () => {
  seed();
  const fresh = Object.values(db.leads).find((l) => l.name === 'Rahul Mehta');
  const r = await cust(fresh.id, file());
  assert.equal(r[0].meta.template, 'nb_intro_consent');
  assert.equal((await services.listDocuments(fresh.id)).length, 0);
});

test('voice: spoken profile prefills the needs form without saving it', async () => {
  const id = optedIn();
  const r = await cust(id, { type: 'audio', mediaId: 'M-x', durationSec: 8, transcript: "I'm 41, I earn 36 lakh a year, I have three kids" });
  assert.match(r[0].text, /I heard/);
  assert.equal(r[1].type, 'flow');
  assert.equal(r[1].flow.id, 'need_profile');
  assert.equal(r[1].flow.prefill.age, 41);
  assert.equal(r[1].flow.prefill.annualIncome, 3600000);
  assert.equal(r[1].flow.prefill.dependents, 3);
  assert.match(r[1].text, /I picked up/);
  assert.equal(db.leads[id].profile.age, 34, 'stored profile is unchanged until the form is submitted');
  assert.ok(db.leads[id].timeline.some((t) => t.type === 'voice'));
});

test('voice: routes to the same journeys as taps', async () => {
  const id = optedIn();
  const docs = await cust(id, { type: 'audio', transcript: 'I want to upload my PAN card' });
  assert.equal(docs[1].list.sections[0].rows[0].id, 'docs:ask:pan');
  const plans = await cust(id, { type: 'audio', transcript: 'show me my plans' });
  assert.equal(plans[1].type, 'list');
  const adv = await cust(id, { type: 'audio', transcript: 'can my advisor call me back' });
  assert.match(adv[1].text, /get in touch/);
});

test('voice: unclear and untranscribed notes get a helpful prompt; opt-out needs confirmation', async () => {
  const id = optedIn();
  const unclear = await cust(id, { type: 'audio', transcript: 'umm okay then' });
  assert.equal(unclear[1].type, 'buttons');
  const none = await cust(id, { type: 'audio', mediaId: 'M-y' });
  assert.match(none[0].text, /could not make out/);

  const stop = await cust(id, { type: 'audio', transcript: 'please stop messaging me' });
  assert.equal(db.leads[id].consent.given, true, 'a voice note alone does not opt out');
  await cust(id, { type: 'button_reply', id: 'optout:confirm' });
  assert.equal(db.leads[id].consent.given, false);
  assert.equal(stop[1].buttons[0].id, 'optout:confirm');
});
