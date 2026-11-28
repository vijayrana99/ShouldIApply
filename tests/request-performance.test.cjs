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
  h.context.setTimeout = (callback, delay) => { assert.equal(delay, 180000); triggerTimeout = callback; return 123; };
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

test('compact contract omits unused prose while retaining consumed evidence and placement fields', async () => {
  const h = harness([{ fitScore: 70, matched: [], missing: [], gaps: [] }]);
  const result = await h.context.handleCvFit({ job, context: extracted });
  assert.equal(result.ok, true);
  const prompt = h.requests[0].messages[1].content;
  assert.ok(!prompt.includes('"verdict"'));
  assert.ok(!prompt.includes('"reason"'));
  for (const field of ['"requirementIndex"','"evidenceStrength"','"matchLevel"','"why"','"status"','"jobQuote"','"cvQuote"','"clarificationQuote"','"placementFacts"']) {
    assert.ok(prompt.includes(field), field);
  }
});

test('token usage and attempt number are recorded without recording request content', async () => {
  const h = harness();
  const logs = [];
  h.context.console = { info(...args) { logs.push(args); } };
  h.context.fetch = async () => ({ ok: true, json: async () => ({
    usage: { prompt_tokens: 1500, completion_tokens: 320, total_tokens: 1820, completion_tokens_details: { reasoning_tokens: 100 } },
    choices: [{ message: { content: 'Answer' } }],
  }) });
  await h.context.callOpenRouter([{role:'user',content:'Private CV'}], 'test-model','private-key','extraction-retry',2);
  const metrics = logs[0][1];
  assert.equal(metrics.attempt, 2);
  assert.equal(metrics.inputTokens, 1500);
  assert.equal(metrics.outputTokens, 320);
  assert.equal(metrics.reasoningTokens, 100);
  assert.equal(metrics.totalTokens, 1820);
  assert.equal(metrics.errorCode, null);
  assert.ok(!JSON.stringify(logs).includes('Private CV'));
  assert.ok(!JSON.stringify(logs).includes('private-key'));
});

test('missing token usage is unavailable rather than zero', async () => {
  const h=harness(['Answer']);const logs=[];
  h.context.console={info(...args){logs.push(args);}};
  await h.context.callOpenRouter([], 'test-model','test-key');
  assert.equal(logs[0][1].inputTokens,null);
  assert.equal(logs[0][1].outputTokens,null);
});


test('slow AI headers and body can complete after 45 seconds and before three minutes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = harness();
  let signal;
  let sendHeaders;
  let sendBody;
  let bodyStarted;
  const readingBody = new Promise(resolve => { bodyStarted = resolve; });
  let keepAliveCalls = 0;
  h.chrome.runtime.getPlatformInfo = async () => { keepAliveCalls++; };
  h.context.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { sendHeaders = resolve; });
  };
  const pending = h.context.callOpenRouter([], 'test-model', 'test-key');
  t.mock.timers.tick(60000);
  assert.equal(signal.aborted, false, 'A slow first byte must not trigger the old timeout');
  assert.ok(keepAliveCalls > 0, 'Keep the worker active while awaiting headers');
  sendHeaders({ ok: true, json: () => new Promise(resolve => { sendBody = resolve; bodyStarted(); }) });
  await readingBody;
  t.mock.timers.tick(80000);
  assert.equal(signal.aborted, false, 'A response taking 2m 20s is still allowed');
  sendBody({ choices: [{ message: { content: 'Completed answer' } }] });
  assert.equal(await pending, 'Completed answer');
  const completedCalls = keepAliveCalls;
  t.mock.timers.tick(180000);
  assert.equal(signal.aborted, false, 'Clear the deadline after completion');
  assert.equal(keepAliveCalls, completedCalls, 'Stop keeping the worker active after completion');
});

test('an unanswered AI request is aborted at three minutes and releases its keep-alive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = harness();
  let signal;
  let keepAliveCalls = 0;
  h.chrome.runtime.getPlatformInfo = async () => { keepAliveCalls++; };
  h.context.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('Aborted while waiting for headers');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };
  const pending = h.context.callOpenRouter([], 'test-model', 'test-key');
  const rejected = assert.rejects(pending, error => error.code === 'NETWORK_TIMEOUT' && /3 minutes/.test(error.message));
  t.mock.timers.tick(179999);
  assert.equal(signal.aborted, false, 'Do not cancel before three minutes');
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
  const completedCalls = keepAliveCalls;
  t.mock.timers.tick(60000);
  assert.equal(keepAliveCalls, completedCalls, 'Stop keeping the worker active after timeout');
});
