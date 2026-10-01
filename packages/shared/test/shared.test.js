import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTS, getProduct, analyseNeeds, protectionGap, educationCorpus, generateIllustration, headline, irr,
  toCloudApiPayload, fromCloudApiWebhook, staleness, advanceStage, WATERMARK,
} from '../src/index.js';

test('catalogue has the 9 approved plans with exact UINs', () => {
  const uins = Object.fromEntries(PRODUCTS.map((p) => [p.id, p.uin]));
  assert.deepEqual(uins, {
    srp: '110N176V12', mrss: '110N171V15', fgp: '110N158V14', sfip: '110N207V03', grip: '110N163V13',
    prlpplus: '110L179V02+110N183V02', premiersip: '110L174V01+110N178V01', sps: '110L182V09', fgpension: '110N161V13',
  });
  assert.equal(getProduct('110N183V02').name, 'Health Buddy');
});

test('protection gap = HLV + loans − existing cover', () => {
  const g = protectionGap({ age: 30, annualIncome: 1200000, retirementAge: 60, liabilities: 2000000, existingCover: 5000000 });
  assert.ok(g.hlv > 10000000 && g.hlv < 30000000, `hlv ${g.hlv}`);
  assert.equal(g.required - g.existing >= g.gap - 100000, true);
});

test('education corpus is null without a child under 18', () => {
  assert.equal(educationCorpus({ youngestChildAge: null }), null);
  assert.ok(educationCorpus({ youngestChildAge: 5 }).corpusRequired > 2500000);
});

test('need analysis flags protection for dependents even if not chosen', () => {
  const n = analyseNeeds({ age: 35, dependents: 2, annualIncome: 2000000 }, ['wealth'], 'high');
  assert.equal(n.recommendations[0].goal, 'protection');
  assert.equal(n.recommendations[0].suggested, true);
});

test('low risk never recommends market-linked plans for wealth', () => {
  const n = analyseNeeds({ age: 35, annualIncome: 1500000 }, ['wealth'], 'low');
  const ids = n.recommendations.find((r) => r.goal === 'wealth').productIds;
  assert.ok(ids.every((id) => !getProduct(id).marketLinked));
});

test('every plan produces a watermarked illustration', () => {
  for (const p of PRODUCTS) {
    const bi = generateIllustration(p.id, { age: 35 });
    assert.equal(bi.watermark, WATERMARK);
    assert.equal(bi.source, 'indicative-placeholder');
    assert.equal(bi.uin, p.uin);
    assert.ok(bi.premium.annual > 0, p.id);
    if (bi.marketLinked) assert.ok(bi.notes.length, `${p.id} needs 4%/8% note`);
  }
});

test('ULIP 8% beats 4%; bundles carry both component UINs', () => {
  const bi = generateIllustration('prlpplus', { age: 30 });
  const h = headline(bi);
  assert.ok(h.maturityAt8 > h.maturityAt4);
  assert.deepEqual(bi.components.map((c) => c.uin), ['110L179V02', '110N183V02']);
});

test('irr of a simple cashflow', () => {
  assert.equal(irr([-100, 110]), 10);
});

test('WhatsApp adapter respects button and list limits', () => {
  const p = toCloudApiPayload({ type: 'buttons', text: 'x', buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: 'A very long button title here' })) });
  assert.equal(p.interactive.action.buttons.length, 3);
  assert.ok(p.interactive.action.buttons[0].reply.title.length <= 20);
  assert.deepEqual(fromCloudApiWebhook({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: 'X' } } }), { type: 'list_reply', id: 'x', title: 'X' });
});

test('stage only advances automatically; stale after rule hours', () => {
  assert.equal(advanceStage('bi_shared', 'needs_done'), 'bi_shared');
  assert.equal(advanceStage('new', 'needs_done'), 'needs_done');
  const old = new Date(Date.now() - 50 * 3600e3).toISOString();
  assert.ok(staleness({ stage: 'bi_shared', lastActivityAt: old }).stale);
  assert.equal(staleness({ stage: 'issued', lastActivityAt: old }), null);
});
