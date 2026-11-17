const assert = require('node:assert/strict');
const { test } = require('node:test');
const { harness, job, fit, extracted } = require('./helpers.cjs');

test('compact requirement indexes restore canonical text and category with verified evidence', async () => {
  const indexed = { ...fit, matched: fit.matched.map(({ requirement, ...row }) => ({ ...row, requirementIndex: 0 })) };
  const posting = { ...job, requirements: job.requirements.map(row => ({ ...row, category: 'hard' })) };
  const h = harness([indexed]);
  const result = await h.context.handleCvFit({ job: posting, context: extracted });
  assert.equal(result.ok, true);
  assert.equal(result.fit.matched[0].requirement, posting.requirements[0].text);
  assert.equal(result.fit.matched[0].category, 'hard');
  assert.equal(result.fit.matched[0].jobQuote, fit.matched[0].jobQuote);
  const system = h.requests[0].messages[0].content;
  assert.match(system, /Return only the requested JSON/);
  assert.ok(!system.includes('Never use tables, fenced code'));
  assert.match(h.requests[0].messages[1].content, /requirementIndex/);
});

test('invalid indexes cannot fabricate requirements or inflate coverage', () => {
  const h = harness();
  for (const requirementIndex of [-1, 100, 0.5, '0']) {
    const value = h.context.normalizeFit({ ...fit, missing: [], matched: [{ ...fit.matched[0], requirementIndex }] }, {
      job, sourceText: extracted.text, cvText: h.local.cvText,
    });
    assert.equal(value.matched.length, 0);
    assert.equal(value.missing[0].requirement, job.requirements[0].text);
  }
});

test('request timeout stays active through the JSON body, then clears', async () => {
  const h = harness();
  let triggerTimeout;
  let timerCleared = false;
  let capturedSignal;
  h.context.setTimeout = callback => { triggerTimeout = callback; return 123; };
  h.context.clearTimeout = id => { assert.equal(id, 123); timerCleared = true; };
  h.context.fetch = async (_url, options) => {
    capturedSignal = options.signal;
    return { ok: true, json() {
      assert.equal(timerCleared, false, 'Headers must not clear the timeout');
      return new Promise((_resolve, reject) => {
        capturedSignal.addEventListener('abort', () => {
          const error = new Error('Aborted while reading body');
          error.name = 'AbortError';
          reject(error);
        });
        triggerTimeout();
      });
    } };
  };
  await assert.rejects(h.context.callOpenRouter([{ role: 'user', content: 'Test' }], 'test-model', 'test-key'), error => error.code === 'NETWORK_TIMEOUT');
  assert.equal(capturedSignal.aborted, true);
  assert.equal(timerCleared, true);
});

test('latency diagnostics contain stage and counts without source or credentials', async () => {
  const h = harness(['Private answer']);
  const entries = [];
  h.context.console = { info(...args) { entries.push(args); } };
  await h.context.callOpenRouter([{ role: 'user', content: 'Private CV and source' }], 'test-model', 'secret-api-key', 'extraction');
  assert.equal(entries[0][1].stage, 'extraction');
  assert.equal(entries[0][1].outcome, 'ok');
  assert.equal(entries[0][1].outputCharacters, 'Private answer'.length);
  assert.ok(entries[0][1].elapsedMs >= 0);
  const log = JSON.stringify(entries);
  for (const privateText of ['Private CV', 'Private answer', 'secret-api-key']) assert.ok(!log.includes(privateText));
});

test('HTTP errors retain their classifications after full-response timeout handling', async () => {
  const h = harness();
  h.context.fetch = async () => ({ ok: false, status: 429, text: async () => 'Rate limited' });
  await assert.rejects(h.context.callOpenRouter([], 'test-model', 'test-key'), error => error.code === 'RATE_LIMITED');
});
