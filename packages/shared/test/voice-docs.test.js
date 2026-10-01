import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretVoice, extractSlots, toRupees, classifyDocument, validateUpload, checklist, MAX_UPLOAD_BYTES } from '../src/index.js';

test('Indian amounts: lakh, crore, thousand; bare small numbers are ambiguous', () => {
  assert.equal(toRupees('24', 'lakh'), 2400000);
  assert.equal(toRupees('1.5', 'crore'), 15000000);
  assert.equal(toRupees('50,000'), 50000);
  assert.equal(toRupees('50', 'k'), 50000);
  assert.equal(toRupees('34'), null);
});

test('spoken profile details become slots', () => {
  const s = extractSlots("I'm 34 years old, I earn 24 lakh a year, I have two kids and my youngest child is 4 years, home loan of 55 lakh, expenses 90000 per month");
  assert.deepEqual(s, { youngestChildAge: 4, age: 34, dependents: 2, annualIncome: 2400000, monthlyExpenses: 90000, liabilities: 5500000 });
});

test('monthly income is annualised; the child age is not mistaken for the speaker age', () => {
  assert.equal(extractSlots('my salary is 2 lakh per month').annualIncome, 2400000);
  assert.equal(extractSlots('my son is 6 years').age, undefined);
});

test('intents from typical voice notes', () => {
  const intent = (t) => interpretVoice(t).intent;
  assert.equal(intent('how much cover do I need'), 'needs');
  assert.equal(intent('show me plans for my child'), 'plans');
  assert.equal(intent('I want to compare two plans'), 'compare');
  assert.equal(intent('I want to upload my PAN card'), 'documents');
  assert.equal(intent('please ask my advisor to call me back'), 'advisor');
  assert.equal(intent('please stop messaging me'), 'opt_out');
  assert.equal(intent('mera illustration dikhao'), 'illustrations');
  assert.equal(intent('um hello'), null);
});

test('describing yourself with no keyword still starts a needs analysis', () => {
  const r = interpretVoice('I am 30, I earn 20 lakh and have one child');
  assert.equal(r.intent, 'needs');
  assert.ok(r.confidence < 0.9);
});

test('document classification only when unambiguous', () => {
  assert.equal(classifyDocument('my PAN card'), 'pan');
  assert.equal(classifyDocument(null, 'selfie.jpg'), 'photo');
  assert.equal(classifyDocument('pan and photo'), null);
  assert.equal(classifyDocument(''), null);
});

test('upload validation: type, kind and size', () => {
  assert.ok(validateUpload('pan', { mime: 'image/jpeg', size: 1000 }).ok);
  assert.ok(validateUpload('pan', { mime: 'application/pdf', size: 1000 }).ok);
  assert.ok(!validateUpload('photo', { mime: 'application/pdf', size: 1000 }).ok, 'photo must be an image');
  assert.ok(!validateUpload('pan', { mime: 'video/mp4', size: 1000 }).ok);
  assert.ok(!validateUpload('pan', { mime: 'image/png', size: MAX_UPLOAD_BYTES + 1 }).ok);
});

test('checklist: required documents drive completeness; rejected ones count as missing', () => {
  assert.equal(checklist([]).complete, false);
  const docs = [{ type: 'pan', status: 'received' }, { type: 'photo', status: 'received' }];
  assert.equal(checklist(docs).complete, true);
  assert.equal(checklist([docs[0], { type: 'photo', status: 'rejected' }]).complete, false);
  assert.equal(checklist([{ type: 'pan', status: 'superseded' }, docs[1]]).missing[0].id, 'pan');
});
