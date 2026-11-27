// A captured-source pipeline regression, using reference AI replies and a
// synthetic CV. Live model quality and latency require a separate local run.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { harness, job } = require('./helpers.cjs');
const page = require('./fixtures/brightnetwork-atkins.json');
const source = Object.values(page.excerpts).join('\n');
const sampleCv = 'Led weekly team reviews and coordinated delivery with three developers. Built JavaScript services using agile practices.';
const posting = {
  ...job, role: { title: page.title, company: page.company, location: 'Bristol, Crewe, London or Sheffield' },
  sourceUrl: page.sourceUrl,
  requirements: [
    { text: page.excerpts.collaboration, category: 'soft', tier: 'must-have', ambiguous: false },
    { text: page.excerpts.learning, category: 'soft', tier: 'must-have', ambiguous: false },
  ],
  compensation: { min:26228,max:30784,currency:'GBP',period:'year',extras:[] },
  eligibility:[page.excerpts.office], flags:[{severity:'warning',text:page.excerpts.office}],
  applicationDeadline:'2026-12-03',
};
const reply = {
  fitScore:75,
  matched:[{requirementIndex:0,evidenceStrength:'demonstrated',matchLevel:'direct',why:'Your CV describes coordinating delivery with developers.',jobQuote:page.excerpts.collaboration,cvQuote:'coordinated delivery with three developers.'}],
  missing:[{requirementIndex:1,evidenceStrength:'mentioned',matchLevel:'partial',status:'not_evidenced',why:'Agile practice is mentioned but learning new technologies needs an example.',jobQuote:page.excerpts.learning,cvQuote:null}],
  gaps:[{area:'Office attendance',severity:'risk',status:'not_evidenced',text:'Confirm availability for at least three days onsite.',jobQuote:page.excerpts.office,cvQuote:null}],
  placementFacts:{start:{},duration:{},hours:{},end:{},project:{status:'unclear',quote:null}},
};

test('Bright Network reference result preserves mandatory onsite conditions, evidence, and missing placement information', async () => {
  const h=harness([posting,reply], {local:{cvText:sampleCv,placementProfile:{enabled:true,earliestStart:'2027-09-13',latestStart:'2027-10-04',minWeeks:30,maxWeeks:34,hoursPerWeek:28,hoursRule:'unconfirmed'}}});
  h.chrome.tabs.get=async()=>({id:1,url:page.sourceUrl,title:page.title});
  h.chrome.scripting.executeScript=async()=>[{result:{title:page.title,text:source}}];
  const result=await h.context.handleExtractJob(1);
  assert.equal(result.ok,true);
  assert.equal(h.requests.length,2);
  assert.equal(result.job.applicationDeadline,'2026-12-03');
  assert.equal(result.job.compensation.currency,'GBP');
  assert.equal(result.job.eligibility[0],page.excerpts.office);
  assert.equal(result.fit.matched[0].jobQuote,page.excerpts.collaboration);
  assert.equal(result.fit.matched[0].cvQuote,'coordinated delivery with three developers.');
  assert.equal(result.fit.matched[0].category,'soft');
  assert.equal(result.fit.missing[0].status,'not_evidenced');
  assert.equal(result.fit.gaps[0].severity,'risk');
  for(const key of ['start','duration','hours','end','project']) {
    assert.equal(result.fit.placement.checks.find(item=>item.key===key).status,'clarify',key);
  }
  // The eight-week graduate-progression condition must not become a duration
  // fact in the reference result, or a manufactured eight-week placement.
  assert.ok(!result.fit.placement.checks.some(item=>item.status==='blocker'));
  assert.ok(h.requests[0].messages[0].content.includes(page.excerpts.progression));
  assert.ok(h.requests[1].messages[0].content.includes(page.excerpts.office));
});
