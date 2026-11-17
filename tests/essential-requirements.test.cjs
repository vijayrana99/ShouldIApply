const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { harness, loadPopup, job, fit, url } = require('./helpers.cjs');
const language = 'Software development skills in at least one of Python, C/C++';
const source = language + '. Interest in research is desirable.';
const cv = 'Developed backend applications using PHP, TypeScript and JavaScript.';
const posting = { ...job, requirements: [
  { text: language, tier: 'must-have', category: 'hard' },
  { text: 'Interest in research', tier: 'nice-to-have', category: 'soft' },
] };
const result = { fitScore: 45, matched: [], missing: [
  { requirement: language, status: 'not_evidenced', jobQuote: language, cvQuote: null, why: 'Python and C/C++ are not evidenced in your CV.' },
  { requirement: 'Interest in research', status: 'not_evidenced', jobQuote: 'Interest in research is desirable.', cvQuote: null },
], gaps: [] };

test('SLB mandatory languages are surfaced on the initial pass even without a model-generated blocker', async () => {
  const h = harness([result], { local: { cvText: cv } });
  const response = await h.context.handleCvFit({ job: posting, context: { title: 'SLB internship', text: source } });
  assert.equal(response.ok, true);
  const popup = loadPopup(h);
  const essential = popup.essentialFindings(posting, response.fit);
  assert.equal(essential.confirmed.length, 0);
  assert.equal(essential.unverified.length, 1);
  assert.equal(essential.unverified[0].requirement, language);
});

test('confirmed essential gaps and partial matches are distinguished from desirable missing skills', () => {
  const popup = loadPopup(harness());
  const confirmed = { ...result, missing: result.missing.map(item => ({ ...item, status: 'confirmed_gap' })) };
  assert.equal(popup.essentialFindings(posting, confirmed).confirmed.length, 1);
  const partial = { matched: [{ requirement: language, matchLevel: 'transferable' }], missing: [] };
  assert.equal(popup.essentialFindings(posting, partial).unverified.length, 1);
});

test('initial page renders blockers directly after the analysis summary, then unverified essentials', () => {
  const popup = loadPopup(harness());
  vm.runInContext(`
    renderBlockers = () => 'blockers';
    renderEssentialRequirements = () => 'essential';
    renderFitHero = () => 'score';
    renderPlacementSuitability = () => null;
    renderFlags = () => null;
    renderSkillsMatrix = () => 'skills';
    renderGaps = () => null;
    renderSavedClarifications = () => null;
    renderDetails = () => 'details';
    updateFooter = () => {};
  `, popup);
  const children = [];
  popup.renderJobViewInto({ appendChild(child) { children.push(child); } }, posting, result);
  assert.deepEqual(children, ['score', 'blockers', 'essential', 'skills', 'details']);
});

test('follow-ups reuse the normalized findings and explicitly reject absence-as-proof and screening predictions', async () => {
  const h = harness([result, 'Answer'], { local: { cvText: cv } });
  const response = await h.context.handleCvFit({ job: posting, context: { title: 'SLB internship', text: source } });
  await h.context.setCachedJob(url, response.fit.cvFp, { extraction: posting, fit: response.fit });
  await h.context.handleChat({ context: { title: 'SLB internship', text: source }, sourceUrl: url, history: [], question: 'So no blocks?' });
  const system = h.requests[1].messages[0].content;
  assert.match(system, /CURRENT ASSESSMENT/);
  assert.match(system, /not_evidenced/);
  assert.match(system, /Do not strengthen a claim just because the user challenges it/);
  assert.match(system, /Do not predict automated-screening failure/);
  assert.match(system, /A higher qualification does not automatically satisfy/);
});
