// Run with: node --test tests/*.test.cjs
// Mocks verify request flow and parsing, not a live model's language quality.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { harness, job, fit, nepali, english, spanish, url, extracted, assertSourcePolicy, loadPopup } = require('./helpers.cjs');

test('summaries use source language even when the CV is in another language', async () => {
  for (const [text, cvText, reply] of [
    [nepali, english, 'नेपाली सारांश'],
    [english, nepali, 'English summary'],
    [spanish, english, 'Resumen en español'],
  ]) {
    const h = harness([reply]);
    const result = await h.context.runGenericSummary({ extracted: { ...extracted, text }, cvText, model: 'test-model', apiKey: 'test-key', includeCvFit: false });
    assert.equal(result, reply);
    assertSourcePolicy(h.requests[0], text);
  }
});

test('CV comparison fallback localizes its heading as well as its prose', async () => {
  const h = harness(['तपाईंको सीभीसँग तुलना']);
  await h.context.runGenericSummary({ extracted, cvText: english, model: 'test-model', apiKey: 'test-key', includeCvFit: true });
  assertSourcePolicy(h.requests[0]);
  assert.match(h.requests[0].messages[1].content, /heading meaning "Fit with your CV" in the source language/);
});

test('extraction and fit JSON retries retain the original source and enum schema', async () => {
  const h = harness(['invalid JSON', job, 'invalid JSON', fit]);
  const result = await h.context.handleExtractJob(1);
  assert.equal(result.ok, true);
  assert.equal(h.requests.length, 4);
  h.requests.forEach(request => assertSourcePolicy(request));
  assert.equal(result.job.requirements[0].tier, 'must-have');
  assert.equal(result.job.flags[0].severity, 'warning');
  assert.equal(result.job.role.workArrangement, 'Remote');
  assert.equal(result.fit.gaps[0].severity, 'risk');
  assert.equal(result.fit.matched[0].why, fit.matched[0].why);
  assert.equal(result.fit.fitScore, 70);
  // Reopening the same job still reuses a newly generated result.
  await h.context.handleExtractJob(1);
  assert.equal(h.requests.length, 4);
});

test('direct CV-fit calls without raw context use extracted requirements, not only the title', async () => {
  const h = harness([fit]);
  assert.equal((await h.context.handleCvFit({ job })).ok, true);
  assertSourcePolicy(h.requests[0], job.requirements[0].text);
});

test('invalid fit falls back to a source-language plain-text comparison', async () => {
  const h = harness([job, {}, 'सीभीसँगको तुलना']);
  const result = await h.context.handleExtractJob(1);
  assert.equal(result.ok, true);
  assert.equal(result.fit, null);
  assert.equal(result.fitFallback, 'सीभीसँगको तुलना');
  h.requests.forEach(request => assertSourcePolicy(request));
});

test('English follow-up questions and old English replies do not replace source language', async () => {
  const h = harness(['तपाईंको अनुभव मिल्छ।']);
  const result = await h.context.handleChat({
    context: extracted,
    history: [{ role: 'assistant', content: 'Previous English answer.' }],
    question: 'What skills are required?',
  });
  assert.equal(result.answer, 'तपाईंको अनुभव मिल्छ।');
  assertSourcePolicy(h.requests[0]);
  assert.equal(h.requests[0].messages.at(-1).content, 'What skills are required?');
});

test('salary notes and recruiter questions receive the original source language', async () => {
  const h = harness([
    { min: 1, median: 2, max: 3, currency: 'USD', period: 'year', note: 'यो अनुमान हो।' },
    { gapQuestions: ['तलब कति हो?', 'अन्तर्वार्ता कहिले हुन्छ?', 'आवेदनको अन्तिम मिति के हो?'] },
  ]);
  const result = await h.context.handleMissingDataAnalysis({ job, context: extracted });
  assert.equal(result.ok, true);
  h.requests.forEach(request => assertSourcePolicy(request));
  assert.equal(result.data.salaryEstimate.currency, 'USD');
  assert.equal(result.data.salaryEstimate.period, 'year');
  assert.equal(result.data.salaryEstimate.note, 'यो अनुमान हो।');
  assert.equal(result.data.gapQuestions[0], 'तलब कति हो?');
  await h.context.handleMissingDataAnalysis({ job, context: extracted });
  assert.equal(h.requests.length, 2, 'Current analysis should remain cacheable');
});

test('old job and fit cache entries are regenerated', async () => {
  const h = harness([job, fit], { session: { summaJobCache: { [url]: { extraction: job, fit, cvFp: 'old' } } } });
  assert.equal(await h.context.getCachedJob(url, 'old'), null);
  const result = await h.context.handleExtractJob(1);
  assert.equal(result.ok, true);
  assert.equal(h.requests.length, 2);
  assert.equal(h.session.summaJobCache[url].responseLanguageVersion, 1);
});

test('refreshing old missing-data analysis cannot revalidate an old-language fit', async () => {
  const h = harness([{ gapQuestions: ['तलबका अतिरिक्त सुविधा के छन्?'] }], {
    session: { summaJobCache: { [url]: { extraction: job, fit, analysis: { gapQuestions: ['Old English question?'] } } } },
  });
  const result = await h.context.handleMissingDataAnalysis({ job: { ...job, compensation: { min: 1 } } });
  assert.equal(result.data.gapQuestions[0], 'तलबका अतिरिक्त सुविधा के छन्?');
  assertSourcePolicy(h.requests[0], job.requirements[0].text);
  assert.equal(await h.context.getCachedJob(url, ''), null);
});

test('CV changes still invalidate fit while keeping current-language extraction', async () => {
  const h = harness();
  await h.context.setCachedJob(url, 'cv-one', { extraction: job, fit, fitFallback: null });
  const cached = await h.context.getCachedJob(url, 'cv-two');
  assert.equal(cached.extraction, job);
  assert.equal(cached.fit, null);
});

test('popup rejects legacy sessions and restores newly saved source-language sessions', async () => {
  const h = harness([], { local: { summaSessions: { 'tab-1': { extracted, sourceUrl: url, summary: 'Old English answer' } } } });
  const popup = loadPopup(h);
  assert.equal(await popup.restoreSession(1), false);
  assert.equal(vm.runInContext('RESPONSE_LANGUAGE_VERSION', popup), vm.runInContext('RESPONSE_LANGUAGE_VERSION', h.context));
  popup.testSource = extracted;
  vm.runInContext('currentTabId = 1; extracted = testSource; els.summaryText.dataset.raw = "नेपाली सारांश";', popup);
  await popup.saveSession();
  assert.equal(h.local.summaSessions['tab-1'].responseLanguageVersion, 1);
  popup.rendered = null;
  vm.runInContext('renderSummary = text => { rendered = text; }; renderChips = async () => {};', popup);
  assert.equal(await popup.restoreSession(1), true);
  assert.equal(popup.rendered, 'नेपाली सारांश');
});

test('popup passes raw source to missing-data analysis', async () => {
  const h = harness();
  let request;
  h.chrome.runtime.sendMessage = async message => { request = message; return { ok: false }; };
  const popup = loadPopup(h);
  popup.testSource = extracted;
  popup.testJob = job;
  vm.runInContext('extracted = testSource; currentJob = testJob;', popup);
  await popup.loadAnalysis();
  assert.equal(request.context.text, nepali);
  assert.equal(request.action, 'missingDataAnalysis');
});
