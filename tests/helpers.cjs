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
  matched: [{ requirement: job.requirements[0].text, why: 'सीभीमा आवश्यक अनुभव उल्लेख छ।', jobQuote: 'उम्मेदवारसँग JavaScript मा दुई वर्षको अनुभव हुनुपर्छ।', cvQuote: 'I have two years of JavaScript experience.' }],
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
  const listeners = [];
  const local = { openrouterApiKey: 'test-key', cvText: 'I have two years of JavaScript experience.', ...initial.local };
  const session = initial.session || {};
  const chrome = {
    runtime: { onMessage: { addListener(listener) { listeners.push(listener); } } },
    action: { onClicked: { addListener() {} } },
    storage: { local: storage(local), session: storage(session), sync: storage({ model: 'test-model' }) },
    tabs: { async get() { return { id: 1, url, title: 'Software Engineer job' }; } },
    scripting: { async executeScript() { return [{ result: extracted }]; } },
  };
  const context = vm.createContext({
    chrome, console, setTimeout, clearTimeout, AbortController,
    importScripts(...paths) {
      paths.forEach(path => vm.runInContext(readFileSync(join(root, path), 'utf8'), context));
    },
    async fetch(_url, options) {
      requests.push(JSON.parse(options.body));
      assert.ok(replies.length, 'Unexpected extra model request');
      const reply = replies.shift();
      return { ok: true, async json() { return { choices: [{ message: { content: typeof reply === 'string' ? reply : JSON.stringify(reply) } }] }; } };
    },
  });
  vm.runInContext(readFileSync(join(root, 'background.js'), 'utf8'), context);
  return { context, local, session, requests, chrome, listeners };
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

function loadPopup(h) {
  h.context.document = { getElementById() { return { dataset: {}, innerHTML: '', hidden: true }; } };
  // Only skip browser bootstrapping; test the production session functions.
  const source = readFileSync(join(root, 'popup.js'), 'utf8').replace(/\ninit\(\);\s*$/, '\n');
  const popup = vm.createContext({ chrome: h.chrome, document: h.context.document, console });
  vm.runInContext(readFileSync(join(root, 'placement.js'), 'utf8'), popup);
  vm.runInContext(source, popup);
  return popup;
}


module.exports = { harness, job, fit, nepali, english, spanish, url, extracted, assertSourcePolicy, loadPopup };
