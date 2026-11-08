// Run with: node --test tests/source-language.test.cjs
// Exercises the real handlers with mocked Chrome/OpenRouter boundaries.
// These tests verify requests and parsing, not a live model's language quality.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const nepali = 'हामी काठमाडौंमा सफ्टवेयर इन्जिनियर खोजिरहेका छौं। उम्मेदवारसँग JavaScript मा दुई वर्षको अनुभव हुनुपर्छ। जिम्मेवारीमा वेब अनुप्रयोग विकास र परीक्षण समावेश छन्।';
const english = 'We are hiring a software engineer with two years of JavaScript experience to build and test web applications.';
const spanish = 'Buscamos una persona con experiencia en JavaScript para desarrollar y probar aplicaciones web.';
const url = 'https://example.test/jobs/engineer';
const extracted = { title: 'Software Engineer', text: nepali, type: 'webpage' };
const job = {
  contentType: 'job_posting', confidence: 'high', sourceUrl: url,
  role: { title: 'Software Engineer', company: 'Example', location: 'काठमाडौं', workArrangement: 'Remote' },
  compensation: { min: null, max: null, extras: [] },
  flags: [{ severity: 'warning', text: 'काम गर्ने अनुमति आवश्यक छ।' }],
  requirements: [{ tier: 'must-have', text: 'JavaScript मा दुई वर्षको अनुभव', ambiguous: false }],
  responsibilities: ['वेब अनुप्रयोग विकास'], benefits: [], eligibility: [],
  process: { stages: [], assessmentAreas: [] },
};
const fit = {
  fitScore: 70, verdict: 'आंशिक मेल',
  matched: [{ requirement: job.requirements[0].text, why: 'सीभीमा आवश्यक अनुभव उल्लेख छ।' }],
  missing: [], gaps: [{ area: 'परीक्षण', severity: 'risk', text: 'परीक्षण अनुभव स्पष्ट छैन।' }],
  reason: 'थप अनुभवको पुष्टि आवश्यक छ।',
};

function storage(values) {
  return {
    async get(keys) { return Object.fromEntries(keys.map(key => [key, values[key]])); },
    async set(entries) { Object.assign(values, entries); },
    async remove(key) { delete values[key]; },
  };
}
function harness(replies = [], initial = {}) {
  const requests = [];
  const local = { openrouterApiKey: 'test-key', cvText: 'I have two years of JavaScript experience.', ...initial.local };
  const session = initial.session || {};
  const chrome = {
    runtime: { onMessage: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    storage: { local: storage(local), session: storage(session), sync: storage({ model: 'test-model' }) },
    tabs: { async get() { return { id: 1, url, title: 'Software Engineer job' }; } },
    scripting: { async executeScript() { return [{ result: extracted }]; } },
  };
  const context = vm.createContext({
    chrome, console, setTimeout, clearTimeout, AbortController,
    async fetch(_url, options) {
      requests.push(JSON.parse(options.body));
      assert.ok(replies.length, 'Unexpected extra model request');
      const reply = replies.shift();
      return { ok: true, async json() { return { choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] }; } };
    },
  });
  vm.runInContext(readFileSync(join(root, 'background.js'), 'utf8'), context);
  return { context, local, session, requests, chrome };
}
function assertSourcePolicy(request, source = nepali) {
  const system = request.messages[0];
  assert.equal(system.role, 'system');
  assert.match(system.content, /primary language of the article or job/);
  assert.match(system.content, /Nepali response in Devanagari/);
  assert.match(system.content, /CV, question, previous answers/);
  assert.match(system.content, /keep property names, enum values, numbers, booleans, null/);
  const sourceBlock = system.content.match(/=== SOURCE CONTENT[^\n]* ===\n([\s\S]*?)\n=== END SOURCE CONTENT ===/);
  assert.ok(sourceBlock, 'Original source must be labelled separately from the CV');
  assert.ok(sourceBlock[1].includes(source), 'Source text must survive every analysis stage');
}

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

function loadPopup(h) {
  h.context.document = { getElementById() { return { dataset: {}, innerHTML: '', hidden: true }; } };
  // Only skip browser bootstrapping; test the production session functions.
  const source = readFileSync(join(root, 'popup.js'), 'utf8').replace(/\ninit\(\);\s*$/, '\n');
  const popup = vm.createContext({ chrome: h.chrome, document: h.context.document, console });
  vm.runInContext(source, popup);
  return popup;
}

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
