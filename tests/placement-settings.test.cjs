const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers.cjs');
const profile = {
  enabled: true, earliestStart: '2027-09-13', latestStart: '2027-10-04', minWeeks: 30, maxWeeks: 34,
  hoursPerWeek: 28, hoursRule: 'unconfirmed', termTimeOnly: true, latestEndDate: '',
  returnToStudy: true, dissertationAlternative: true, computingProjectRequired: true, projectArea: 'Computer Science',
};
function settings() {
  const h = harness();
  const fields = {};
  const checkboxes = ['placement-enabled','placement-term-time','placement-return','placement-dissertation','placement-project','placement-remaining-confirmed'];
  const numbers = ['placement-min-weeks','placement-max-weeks','placement-hours','placement-percent'];
  const document = {
    getElementById(id) {
      if (!fields[id]) fields[id] = { type: checkboxes.includes(id) ? 'checkbox' : numbers.includes(id) ? 'number' : 'text', value: '', checked: false, events: {}, hidden: true,
        addEventListener(name, handler) { this.events[name] = handler; }, scrollIntoView() {} };
      return fields[id];
    },
  };
  const context = vm.createContext({ chrome: h.chrome, document, setTimeout() {}, console });
  vm.runInContext(readFileSync(join(__dirname, '..', 'placement.js'), 'utf8'), context);
  vm.runInContext(readFileSync(join(__dirname, '..', 'options.js'), 'utf8'), context);
  return { ...h, fields, context };
}

test('import loads the agreed profile; Save persists it locally without editing the CV', async () => {
  const h = settings();
  await h.context.load();
  const target = { files: [{ size: 500, text: async () => JSON.stringify(profile) }], value: 'profile.json' };
  await h.fields['placement-import'].events.change({ target });
  assert.equal(h.fields['placement-earliest'].value, '2027-09-13');
  assert.equal(h.fields['placement-latest'].value, '2027-10-04');
  assert.equal(h.fields['placement-min-weeks'].value, 30);
  assert.equal(h.fields['placement-hours-rule'].value, 'unconfirmed');
  assert.equal(h.local.placementProfile, undefined, 'Import needs an explicit Save');
  await h.fields['settings-form'].events.submit({ preventDefault() {} });
  assert.equal(h.local.placementProfile.maxWeeks, 34);
  assert.equal(h.local.placementProfile.latestEndDate, '');
  assert.equal(h.local.placementProfile.returnToStudy, true);
  assert.equal(h.local.cvText, 'I have two years of JavaScript experience.');
});

test('invalid imported JSON leaves settings intact and shows an error', async () => {
  const h = settings();
  await h.context.load();
  await h.fields['placement-import'].events.change({ target: { files: [{ size: 10, text: async () => '{invalid' }], value: 'profile.json' } });
  assert.equal(h.fields['placement-enabled'].checked, false);
  assert.equal(h.fields['placement-message'].hidden, false);
  assert.equal(h.local.placementProfile, undefined);
});

test('invalid duration order is not saved', async () => {
  const h = settings();
  await h.context.load();
  h.fields['placement-min-weeks'].value = '35';
  h.fields['placement-max-weeks'].value = '34';
  await h.fields['settings-form'].events.submit({ preventDefault() {} });
  assert.equal(h.local.placementProfile, undefined);
  assert.match(h.fields['placement-message'].textContent, /minimum no greater/);
});
