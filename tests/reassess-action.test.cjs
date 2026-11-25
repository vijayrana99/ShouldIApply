const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { harness, loadPopup, job, fit, extracted, url } = require('./helpers.cjs');

function connectWorker(h) {
  h.chrome.runtime.sendMessage = request => new Promise(resolve => {
    let pending = false;
    let responded = false;
    for (const listener of h.listeners) {
      const keepAlive = listener(request, { tab: { id: 1 } }, response => { responded = true; resolve(response); });
      pending ||= keepAlive === true;
    }
    if (!pending && !responded) resolve(undefined);
  });
}
function preparePopup(h) {
  const popup = loadPopup(h);
  popup.testJob = job;
  popup.testSource = extracted;
  popup.controls = [{ disabled: false }];
  vm.runInContext(`
    currentJob = testJob;
    extracted = testSource;
    currentTabId = 1;
    els.result.scrollTop = 42;
    els.jobView.querySelectorAll = () => controls;
    renderJobViewInto = () => {};
  `, popup);
  return popup;
}

test('save and reassess reaches the registered worker route and persists the result', async () => {
  const h = harness([fit]);
  connectWorker(h);
  const popup = preparePopup(h);
  const feedback = {};
  assert.equal(await popup.updateFitClarification(job.requirements[0].text, 'has_experience', 'Built JavaScript apps for two years.', feedback), true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.local.summaFitClarifications[url].items[0].detail, 'Built JavaScript apps for two years.');
  assert.equal(h.local.summaSessions['tab-1'].fit.clarificationRevision, 1);
  assert.equal(popup.controls[0].disabled, false);
});

test('an old worker gives an inline reload instruction instead of a silent no-op', async () => {
  const h = harness();
  const calls = [];
  h.chrome.runtime.sendMessage = async request => { calls.push(request); return undefined; };
  const popup = preparePopup(h);
  const feedback = { hidden: true };
  assert.equal(await popup.updateFitClarification(job.requirements[0].text, 'has_experience', 'Keep this draft.', feedback), false);
  assert.equal(calls.length, 1);
  assert.match(feedback.textContent, /Reload ShouldIApply in chrome:\/\/extensions/);
  assert.equal(feedback.hidden, false);
  assert.equal(popup.controls[0].disabled, false);
  assert.equal(vm.runInContext('fitUpdateInFlight', popup), false);
});

test('a disconnected extension gives reload instructions and releases the action lock', async () => {
  const h = harness();
  h.chrome.runtime.sendMessage = async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  const popup = preparePopup(h);
  const feedback = {};
  assert.equal(await popup.updateFitClarification(job.requirements[0].text, 'has_experience', 'My experience', feedback), false);
  assert.match(feedback.textContent, /Reload ShouldIApply/);
  assert.equal(vm.runInContext('fitUpdateInFlight', popup), false);
});

test('API errors appear beside the form and controls allow retrying', async () => {
  const h = harness();
  h.chrome.runtime.sendMessage = async request => request.action === 'getAssessmentCapabilities'
    ? { ok: true, clarifyFit: true, evidenceVersion: 2 }
    : { ok: false, error: 'RATE_LIMITED', message: 'OpenRouter rate limit reached. Try again shortly.' };
  const popup = preparePopup(h);
  const feedback = {};
  assert.equal(await popup.updateFitClarification(job.requirements[0].text, 'has_experience', 'My experience', feedback), false);
  assert.match(feedback.textContent, /rate limit/);
  assert.equal(popup.controls[0].disabled, false);
  assert.equal(h.local.summaFitClarifications, undefined);
});
