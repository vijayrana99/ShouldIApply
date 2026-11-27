const assert = require('node:assert/strict');
const { test } = require('node:test');
const { harness, loadPopup } = require('./helpers.cjs');
function setup() {
  const popup = loadPopup(harness());
  let now = 1000;
  const callbacks = new Map();
  const cleared = [];
  let next = 0;
  popup.Date = { now: () => now };
  popup.setInterval = callback => { callbacks.set(++next, callback); return next; };
  popup.clearInterval = id => { callbacks.delete(id); cleared.push(id); };
  const indicators = [];
  popup.document.createElement = () => {
    const attributes = {};
    const node = { attributes, removed: false, setAttribute(key, value) { attributes[key] = value; }, remove() { this.removed = true; } };
    indicators.push(node);
    return node;
  };
  return { popup, callbacks, cleared, indicators, advance(ms) { now += ms; callbacks.forEach(callback => callback()); } };
}

test('elapsed timer handles minutes and delayed callbacks without claiming a completion estimate', () => {
  const h = setup();
  h.popup.startWaitTimer({ appendChild() {} });
  assert.equal(h.indicators[0].textContent, '0:00 elapsed');
  h.advance(12000);
  assert.equal(h.indicators[0].textContent, '0:12 elapsed');
  h.advance(53000);
  assert.equal(h.indicators[0].textContent, '1:05 elapsed · Still working…');
  assert.equal(h.indicators[0].attributes['aria-hidden'], 'true');
});

test('restarting a timer clears its old interval and stopping removes the indicator', () => {
  const h = setup();
  const target = { appendChild() {} };
  h.popup.startWaitTimer(target);
  h.popup.startWaitTimer(target);
  assert.equal(h.callbacks.size, 1);
  assert.equal(h.indicators[0].removed, true);
  h.popup.stopWaitTimer(target);
  assert.equal(h.callbacks.size, 0);
  assert.equal(h.indicators[1].removed, true);
});

test('separate requests keep independent timer lifetimes', () => {
  const h = setup();
  const analysis = { appendChild() {} };
  const chat = { appendChild() {} };
  h.popup.startWaitTimer(analysis);
  h.advance(10000);
  h.popup.startWaitTimer(chat);
  h.advance(5000);
  assert.equal(h.indicators[0].textContent, '0:15 elapsed');
  assert.equal(h.indicators[1].textContent, '0:05 elapsed');
  h.popup.stopWaitTimer(analysis);
  assert.equal(h.callbacks.size, 1);
  h.popup.stopWaitTimer(chat);
});

test('failed initial assessment stops the timer and enables retry', async () => {
  const h = setup();
  h.popup.chrome.runtime.sendMessage = async () => { throw new Error('Disconnected'); };
  require('node:vm').runInContext('currentTabId = 1;', h.popup);
  await h.popup.summarize();
  assert.equal(h.callbacks.size, 0);
  assert.equal(require('node:vm').runInContext('els.summarizeBtn.disabled', h.popup), false);
});
