const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { harness, job, fit, extracted, url, loadPopup } = require('./helpers.cjs');
const profile = {
  enabled: true, earliestStart: '2027-09-13', latestStart: '2027-10-04',
  minWeeks: 30, maxWeeks: 34, hoursPerWeek: 28, hoursRule: 'unconfirmed',
  termTimeOnly: true, latestEndDate: '', returnToStudy: true,
  dissertationAlternative: true, computingProjectRequired: true, projectArea: 'Computer Science',
};
const source = extracted.text + '\nFixed start: 5 October 2027. Fixed duration: 35 weeks. 35 hours per week. Build a dashboard to reduce hospital referral delays.';
const facts = {
  start: { earliest: '2027-10-05', latest: '2027-10-05', fixed: true, quote: 'Fixed start: 5 October 2027.' },
  duration: { minWeeks: 35, maxWeeks: 35, fixed: true, quote: 'Fixed duration: 35 weeks.' },
  hours: { hoursPerWeek: 35, fixed: true, quote: '35 hours per week.' },
  project: { status: 'relevant', fixed: false, quote: 'Build a dashboard to reduce hospital referral delays.', reason: 'The project addresses a defined problem using computing.' },
};
function api() { return harness().context.PlacementProfile; }
function check(result, key) { return result.checks.find(item => item.key === key); }

test('30–34 weeks is inclusive; fixed shorter or longer placements conflict', () => {
  const p = api();
  for (const weeks of [30, 34]) assert.equal(check(p.evaluate(profile, { duration: { minWeeks: weeks, maxWeeks: weeks, fixed: true, quote: 'Duration stated' } }), 'duration').status, 'compatible');
  for (const weeks of [29, 35]) assert.equal(check(p.evaluate(profile, { duration: { minWeeks: weeks, maxWeeks: weeks, fixed: true, quote: 'Duration stated' } }), 'duration').status, 'blocker');
});

test('the full agreed start window is inclusive', () => {
  const p = api();
  for (const date of ['2027-09-13', '2027-10-04']) assert.equal(check(p.evaluate(profile, { start: { earliest: date, latest: date, fixed: true, quote: 'Start stated' } }), 'start').status, 'compatible');
  for (const date of ['2027-09-12', '2027-10-05']) assert.equal(check(p.evaluate(profile, { start: { earliest: date, latest: date, fixed: true, quote: 'Start stated' } }), 'start').status, 'blocker');
});

test('unspecified flexibility and partially overlapping windows need clarification', () => {
  const p = api();
  assert.equal(check(p.evaluate(profile, { start: { earliest: '2027-10-05', latest: '2027-10-05', fixed: false, quote: 'Start stated' } }), 'start').status, 'clarify');
  assert.equal(check(p.evaluate(profile, { duration: { minWeeks: 28, maxWeeks: 32, fixed: true, quote: 'Duration stated' } }), 'duration').status, 'clarify');
});

test('28 hours has no minimum or maximum meaning until clarified', () => {
  const p = api();
  const hours = { hoursPerWeek: 35, fixed: true, quote: '35 hours per week.' };
  assert.equal(check(p.evaluate(profile, { hours }), 'hours').status, 'clarify');
  assert.equal(check(p.evaluate({ ...profile, hoursRule: 'minimum' }, { hours }), 'hours').status, 'compatible');
  assert.equal(check(p.evaluate({ ...profile, hoursRule: 'maximum' }, { hours }), 'hours').status, 'blocker');
  assert.equal(check(p.evaluate({ ...profile, hoursRule: 'fixed' }, { hours }), 'hours').status, 'blocker');
});

test('returning to study does not invent a latest end date', () => {
  const p = api();
  const result = p.evaluate(profile, { end: { date: '2028-06-01', fixed: true, quote: 'End date stated' } });
  assert.equal(check(result, 'end').status, 'clarify');
  assert.equal(result.profile.latestEndDate, '');
});

test('an explicit end-date conflict requires a confirmed personal deadline and fixed employer date', () => {
  const p = api();
  const end = { date: '2028-06-01', fixed: true, quote: 'End date stated' };
  assert.equal(check(p.evaluate({ ...profile, latestEndDate: '2028-05-31' }, { end }), 'end').status, 'blocker');
  assert.equal(check(p.evaluate({ ...profile, latestEndDate: '2028-05-31' }, { end: { ...end, fixed: false } }), 'end').status, 'clarify');
});

test('computing duties can qualify in healthcare; unspecified or general duties do not establish suitability', () => {
  const p = api();
  assert.equal(check(p.evaluate(profile, facts), 'project').status, 'compatible');
  assert.equal(check(p.evaluate(profile, {}), 'project').status, 'clarify');
  assert.equal(check(p.evaluate(profile, { project: { status: 'unrelated', quote: 'General duties', fixed: false } }), 'project').status, 'clarify');
});

test('invented quotes, invalid dates and unknown durations cannot establish a blocker', () => {
  const h = harness();
  const sanitized = h.context.normalizePlacementFacts({
    start: { earliest: '2027-10-05', latest: '2027-10-05', fixed: true, quote: 'Invented fixed start date.' },
    duration: { minWeeks: -1, maxWeeks: 35, fixed: true, quote: facts.duration.quote },
    hours: { hoursPerWeek: 35, fixed: true, quote: 'Invented hours.' },
  }, source);
  const result = h.context.PlacementProfile.evaluate(profile, sanitized);
  assert.ok(result.checks.every(item => item.status !== 'blocker'));
  assert.equal(h.context.PlacementProfile.date('2027-02-30'), '');
});

test('disabled profiles do not create a placement assessment or enter generic article summaries', async () => {
  const h = harness(['Summary'], { local: { placementProfile: { ...profile, enabled: false } } });
  assert.equal(h.context.PlacementProfile.evaluate({ ...profile, enabled: false }, facts), null);
  await h.context.runGenericSummary({ extracted, model: 'test-model', apiKey: 'test-key', cvText: '', includeCvFit: false });
  assert.ok(!h.requests[0].messages[0].content.includes('2027-09-13'));
});

test('skills score is independent of confirmed placement conflicts', async () => {
  const h = harness([{ ...fit, placementFacts: facts }], { local: { placementProfile: profile } });
  const result = await h.context.handleCvFit({ job, context: { ...extracted, text: source } });
  assert.equal(result.ok, true);
  assert.equal(result.fit.fitScore, fit.fitScore);
  assert.equal(result.fit.placement.status, 'blocker');
  assert.equal(check(result.fit.placement, 'hours').status, 'clarify');
  assert.match(h.requests[0].messages[1].content, /fitScore assesses skills and experience only/);
  assert.match(h.requests[0].messages[1].content, /2027-09-13/);
});

test('editing placement requirements invalidates cached fits and saved panel sessions', async () => {
  const h = harness([{ ...fit, placementFacts: facts }], { local: { placementProfile: profile } });
  const result = await h.context.handleCvFit({ job, context: { ...extracted, text: source } });
  await h.context.setCachedJob(url, result.fit.cvFp, { extraction: job, fit: result.fit });
  assert.ok((await h.context.getCachedJob(url, result.fit.cvFp)).fit);
  h.local.summaSessions = { 'tab-1': { extracted, sourceUrl: url, contentType: 'job_posting', responseLanguageVersion: 1, placementFp: result.fit.placementFp, fit: result.fit } };
  h.local.placementProfile = { ...profile, maxWeeks: 33 };
  assert.equal((await h.context.getCachedJob(url, result.fit.cvFp)).fit, null);
  assert.equal(await loadPopup(h).restoreSession(1), false);
});

test('job follow-ups receive placement preferences, while unrelated chat does not', async () => {
  const h = harness(['Job answer', 'Article answer'], { local: { placementProfile: profile } });
  await h.context.handleChat({ context: extracted, sourceUrl: url, history: [], question: 'Does this meet my placement requirements?' });
  assert.ok(h.requests[0].messages[0].content.includes('2027-09-13'));
  await h.context.handleChat({ context: extracted, history: [], question: 'Summarize this article.' });
  assert.ok(!h.requests[1].messages[0].content.includes('2027-09-13'));
});

test('soft-skill self-descriptions and related experience cannot become direct demonstrated matches', () => {
  const h = harness();
  const soft = { ...job, requirements: [{ text: 'Communication', category: 'soft' }] };
  const result = h.context.normalizeFit({ ...fit, gaps: [], missing: [], matched: [{ requirement: 'Communication', category: 'soft', evidenceStrength: 'mentioned', jobQuote: 'Communication', cvQuote: 'Excellent communicator' }] }, { job: soft, sourceText: 'Communication', cvText: 'Excellent communicator' });
  assert.equal(result.matched[0].category, 'soft');
  assert.equal(result.matched[0].matchLevel, 'partial');
});

test('profile validation rejects reversed dates and durations', () => {
  const p = api();
  assert.ok(p.errors({ ...profile, earliestStart: '2027-10-05' }).length);
  assert.ok(p.errors({ ...profile, minWeeks: 35 }).length);
  assert.equal(p.errors(profile).length, 0);
});

test('related hard-skill experience is not labelled a direct match', () => {
  const h = harness();
  const hard = { ...job, requirements: [{ text: 'React', category: 'hard' }] };
  const result = h.context.normalizeFit({ ...fit, gaps: [], missing: [], matched: [{ requirement: 'React', category: 'hard', evidenceStrength: 'related', matchLevel: 'direct', jobQuote: 'React', cvQuote: 'Built Vue applications' }] }, { job: hard, sourceText: 'React', cvText: 'Built Vue applications' });
  assert.equal(result.matched[0].matchLevel, 'transferable');
});
