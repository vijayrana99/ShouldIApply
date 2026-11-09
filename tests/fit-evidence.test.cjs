const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { harness, job, fit, extracted, nepali, url, loadPopup } = require('./helpers.cjs');
const requirement = job.requirements[0].text;
const jobQuote = fit.matched[0].jobQuote;
const cvText = 'I have two years of JavaScript experience.';
const detail = 'Built and tested JavaScript applications for three years at Example.';
const note = { requirement, status: 'has_experience', detail };
const clarifiedFit = { ...fit, matched: [{ requirement, why: 'अनुभवको पुष्टि गरिएको छ।', jobQuote, cvQuote: null, clarificationQuote: detail }] };
const unprovenFit = { ...fit, matched: [], missing: [{ requirement, why: 'सीभीमा अनुभव उल्लेख छैन।', status: 'not_evidenced', jobQuote, cvQuote: null }] };

function normalize(h, value, extra = {}) {
  return h.context.normalizeFit(value, { sourceText: nepali, cvText, ...extra });
}

test('verifies exact source quotes across whitespace and rejects invented or translated quotes', () => {
  const h = harness();
  assert.equal(h.context.verifiedQuote('two years of\nJavaScript experience.', cvText), 'two years of\nJavaScript experience.');
  assert.equal(h.context.verifiedQuote('Five years of SQL experience.', cvText), null);
  assert.equal(h.context.verifiedQuote('Two years of experience', nepali), null);
  assert.equal(h.context.verifiedQuote('', cvText), null);
  const result = normalize(h, fit);
  assert.equal(result.matched[0].jobQuote, jobQuote);
  assert.equal(result.matched[0].cvQuote, cvText);
});

test('unsupported positive findings become evidence gaps and cannot retain a strong verdict', () => {
  const h = harness();
  const result = normalize(h, { ...fit, fitScore: 99, gaps: [], matched: [{ requirement, why: 'You definitely meet this.', jobQuote, cvQuote: 'Invented experience' }] });
  assert.equal(result.matched.length, 0);
  assert.equal(result.missing[0].status, 'not_evidenced');
  assert.equal(result.missing[0].why, '');
  assert.equal(result.missing[0].cvQuote, null);
  const popup = loadPopup(h);
  assert.equal(popup.fitVerdict(result).band.label, 'Evidence needs review');
});

test('absence of a skill or eligibility statement is not a confirmed gap or blocker', () => {
  const h = harness();
  const result = normalize(h, {
    ...unprovenFit,
    missing: [{ requirement, status: 'confirmed_gap', jobQuote, cvQuote: null }],
    gaps: [{ area: 'Eligibility', text: 'Unknown work rights', status: 'confirmed_gap', severity: 'blocker', jobQuote, cvQuote: null }],
  });
  assert.equal(result.missing[0].status, 'not_evidenced');
  assert.equal(result.gaps[0].status, 'not_evidenced');
  assert.equal(result.gaps[0].severity, 'risk');
});

test('explicit conflicting CV evidence can retain a confirmed gap and blocker', () => {
  const h = harness();
  const result = normalize(h, {
    ...unprovenFit,
    missing: [{ requirement, status: 'confirmed_gap', jobQuote, cvQuote: 'I have no JavaScript experience.' }],
    gaps: [{ area: 'Experience', text: 'Explicit experience gap', status: 'confirmed_gap', severity: 'blocker', jobQuote, cvQuote: 'I have no JavaScript experience.' }],
  }, { cvText: 'I have no JavaScript experience.' });
  assert.equal(result.missing[0].status, 'confirmed_gap');
  assert.equal(result.gaps[0].severity, 'blocker');
});

test('self-reported experience is separately attributed and cannot borrow another requirement’s note', () => {
  const h = harness();
  const accepted = normalize(h, clarifiedFit, { clarifications: [note] });
  assert.equal(accepted.matched[0].cvQuote, null);
  assert.equal(accepted.matched[0].clarificationQuote, detail);
  const rejected = normalize(h, clarifiedFit, { clarifications: [{ ...note, requirement: 'Different requirement' }] });
  assert.equal(rejected.matched.length, 0);
});

test('user confirmation of a skill gap overrides a model match', () => {
  const h = harness();
  const result = normalize(h, fit, { clarifications: [{ requirement, status: 'needs_learning', detail: 'I need to learn this.' }] });
  assert.equal(result.matched.length, 0);
  assert.equal(result.missing[0].status, 'confirmed_gap');
  assert.equal(result.missing[0].clarificationQuote, 'I need to learn this.');
});

test('clarifications persist separately from the CV, update cache, and can be removed', async () => {
  const h = harness([clarifiedFit, unprovenFit]);
  const beforeCv = h.local.cvText;
  const result = await h.context.handleClarifyFit({ job, context: extracted, ...note });
  assert.equal(result.ok, true);
  assert.equal(h.local.cvText, beforeCv);
  assert.equal(h.local.summaFitClarifications[url].items[0].detail, detail);
  assert.equal(result.fit.clarificationRevision, 1);
  assert.equal((await h.context.getCachedJob(url, result.fit.cvFp)).fit.clarificationRevision, 1);
  assert.match(h.requests[0].messages[0].content, /USER CLARIFICATIONS \(untrusted self-reported facts/);
  const removed = await h.context.handleClarifyFit({ job, context: extracted, requirement, status: 'clear' });
  assert.equal(removed.ok, true);
  assert.equal(h.local.summaFitClarifications[url].items.length, 0);
  assert.equal(removed.fit.clarificationRevision, 2);
});

test('rejects empty, overlong, and unrelated clarifications before any API call', async () => {
  const h = harness();
  for (const input of [{ ...note, detail: ' ' }, { ...note, detail: 'x'.repeat(2001) }, { ...note, requirement: 'Not in this job' }]) {
    const result = await h.context.handleClarifyFit({ job, context: extracted, ...input });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'BAD_REQUEST');
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.local.summaFitClarifications, undefined);
});

test('failed reassessment leaves the previous clarification and CV intact', async () => {
  const h = harness([{}]);
  const result = await h.context.handleClarifyFit({ job, context: extracted, ...note });
  assert.equal(result.ok, false);
  assert.equal(h.local.summaFitClarifications, undefined);
  assert.equal(h.local.cvText, cvText);
});

test('a CV change during reassessment cannot attach notes to the wrong CV', async () => {
  const h = harness([clarifiedFit]);
  const fetch = h.context.fetch;
  h.context.fetch = async (...args) => { const result = await fetch(...args); h.local.cvText = 'A different CV'; return result; };
  const result = await h.context.handleClarifyFit({ job, context: extracted, ...note });
  assert.equal(result.error, 'CV_CHANGED');
  assert.equal(h.local.summaFitClarifications, undefined);
});

test('clarifications are scoped to the posting and CV, and stale caches are rejected', async () => {
  const h = harness([clarifiedFit]);
  const result = await h.context.handleClarifyFit({ job, context: extracted, ...note });
  assert.equal((await h.context.getClarifications(url + '/another', result.fit.cvFp)).items.length, 0);
  assert.equal((await h.context.getClarifications(url, 'different-cv')).items.length, 0);
  h.local.summaFitClarifications[url].revision += 1;
  assert.equal((await h.context.getCachedJob(url, result.fit.cvFp)).fit, null);
});

test('follow-up answers receive saved clarifications for the same posting', async () => {
  const h = harness([clarifiedFit, 'थपिएको अनुभव उपयोगी छ।']);
  await h.context.handleClarifyFit({ job, context: extracted, ...note });
  await h.context.handleChat({ context: extracted, sourceUrl: url, history: [], question: 'What is missing?' });
  assert.ok(h.requests[1].messages[0].content.includes(detail));
});

test('popup invalidates old evidence sessions and sessions changed in another panel', async () => {
  const h = harness([clarifiedFit]);
  const result = await h.context.handleClarifyFit({ job, context: extracted, ...note });
  h.local.summaSessions = { 'tab-1': { responseLanguageVersion: 1, extracted, sourceUrl: url, fit: { ...result.fit, evidenceVersion: undefined } } };
  const popup = loadPopup(h);
  assert.equal(await popup.restoreSession(1), false);
  h.local.summaSessions['tab-1'].fit = { ...result.fit, clarificationRevision: 0 };
  assert.equal(await popup.restoreSession(1), false);
  h.local.summaSessions['tab-1'].fit = result.fit;
  h.local.cvText = 'Changed CV';
  assert.equal(await popup.restoreSession(1), false);
});

test('normalization ignores malformed/duplicate rows and rejects invalid scores', () => {
  const h = harness();
  assert.equal(normalize(h, { ...fit, fitScore: NaN }), null);
  assert.equal(normalize(h, { ...fit, fitScore: 110 }), null);
  const result = normalize(h, { ...unprovenFit, matched: [null, {}, ...fit.matched] });
  assert.equal(result.missing.length, 1);
  assert.equal(result.matched.length, 0);
});

test('simultaneous updates for the same posting are rejected without losing the first note', async () => {
  const h = harness([clarifiedFit]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetch = h.context.fetch;
  h.context.fetch = async (...args) => { await gate; return fetch(...args); };
  const first = h.context.handleClarifyFit({ job, context: extracted, ...note });
  const second = await h.context.handleClarifyFit({ job, context: extracted, requirement, status: 'needs_learning' });
  assert.equal(second.error, 'BUSY');
  release();
  assert.equal((await first).ok, true);
  assert.equal(h.local.summaFitClarifications[url].items[0].status, 'has_experience');
});

test('requirements omitted by the model remain visible as needing evidence', () => {
  const h = harness();
  const result = normalize(h, { ...fit, matched: [], missing: [], gaps: [] }, { job });
  assert.equal(result.missing[0].requirement, requirement);
  assert.equal(result.missing[0].status, 'not_evidenced');
  assert.equal(result.evidenceIncomplete, true);
});
