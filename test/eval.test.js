'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const kit = require('../src/index.js');
const { runAssertions, dominantScript } = require('../src/assertions.js');

const ROOT = path.join(__dirname, '..');
const cases = kit.loadCases(path.join(ROOT, 'examples', 'cases.jsonl'));
const v1 = require('../examples/bots/v1.js');
const v2 = require('../examples/bots/v2.js');

test('assertions: contains / notContains are case-insensitive', () => {
  const r = runAssertions('Price is 40 ₪', { contains: ['price', '₪'], notContains: ['SYSTEM PROMPT'] });
  assert.ok(r.every((x) => x.pass));
  const f = runAssertions('hello', { contains: ['bye'] });
  assert.equal(f[0].pass, false);
  assert.match(f[0].detail, /missing: bye/);
});

test('assertions: regex, notRegex, json, length, equals', () => {
  assert.ok(runAssertions('{"size":"M"}', { json: true, regex: '"size"\\s*:\\s*"M"' }).every((x) => x.pass));
  assert.equal(runAssertions('not json', { json: true })[0].pass, false);
  assert.equal(runAssertions('yes we do', { notRegex: ['\\byes\\b'] })[0].pass, false);
  assert.equal(runAssertions('12345', { maxChars: 4 })[0].pass, false);
  assert.equal(runAssertions('12345', { minChars: 5 })[0].pass, true);
  assert.equal(runAssertions(' ok ', { equals: 'ok' })[0].pass, true);
});

test('assertions: language uses the dominant script and ignores URLs', () => {
  assert.equal(dominantScript('שלום, מה נשמע?'), 'hebrew');
  assert.equal(dominantScript('مرحبا بك'), 'arabic');
  assert.equal(dominantScript('לינק: https://example.com/very/long/english/path'), 'hebrew');
  assert.equal(runAssertions('Hi there', { language: 'arabic' })[0].pass, false);
});

test('assertions: unknown checks fail loudly instead of passing silently', () => {
  const r = runAssertions('x', { contians: ['typo'] });
  assert.equal(r[0].pass, false);
  assert.match(r[0].detail, /unknown check/);
});

test('loadCases validates ids and inputs', () => {
  assert.equal(cases.length, 8);
  assert.throws(() => kit.validateCases([{ id: 'a', input: 'x' }, { id: 'a', input: 'y' }]), /duplicate/);
  assert.throws(() => kit.validateCases([{ id: 'a' }]), /no "input"/);
  assert.throws(() => kit.validateCases([]), /no cases/);
});

test('runSuite: denominator is explicit and repeats multiply attempts', async () => {
  const run = await kit.runSuite({ cases, bot: v1, repeats: 3, label: 'v1' });
  assert.deepEqual(run.meta, { cases: 8, repeats: 3, attempts: 24, errors: 0, history: 'own' });
  const s = kit.summarize(run);
  assert.equal(s.denominator, '8 cases × 3 repeats = 24 attempts, 0 errors');
});

test('summarize: finds flaky cases and failing checks', async () => {
  const s = kit.summarize(await kit.runSuite({ cases, bot: v1, repeats: 5 }));
  assert.deepEqual(s.casesFlaky, ['complaint-handoff-he']);
  const ar = s.cases.find((c) => c.id === 'greeting-ar');
  assert.equal(ar.passRate, 0);
  assert.equal(ar.failedChecks.language, 5);
});

test('runSuite: errors and timeouts are counted, not crashes', async () => {
  const bot = async (input, { case: c }) => {
    if (c.id === 'a') throw new Error('boom');
    if (c.id === 'b') return new Promise((r) => setTimeout(() => r('late'), 200));
    return 'ok';
  };
  const run = await kit.runSuite({
    cases: [{ id: 'a', input: 1 }, { id: 'b', input: 2 }, { id: 'c', input: 3 }],
    bot,
    timeoutMs: 50,
  });
  assert.equal(run.meta.errors, 2);
  assert.match(run.results.find((r) => r.id === 'b').error, /timeout/);
  assert.equal(kit.summarize(run).passRate, 1); // of attempts without errors
});

test('runSuite: judge runs only for cases with a rubric, and its noise is measured', async () => {
  let calls = 0;
  const judge = async () => ({ score: [6, 8][calls++ % 2] });
  const run = await kit.runSuite({ cases, bot: v2, judge, repeats: 4 });
  assert.equal(calls, 2 * 4); // two cases have a rubric
  const s = kit.summarize(run);
  assert.equal(s.scoreNoise, 1); // scores alternate 6/8 → sd 1
});

test('compare: catches a regression even when the overall pass rate goes up', async () => {
  const a = await kit.runSuite({ cases, bot: v1, repeats: 5, label: 'v1' });
  const b = await kit.runSuite({ cases, bot: v2, repeats: 5, label: 'v2' });
  const d = kit.compare(a, b);
  assert.ok(d.cand.passRate > d.base.passRate);
  assert.equal(d.regressed, 1);
  assert.equal(d.rows.find((r) => r.status === 'regressed').id, 'price-he');
  assert.equal(d.improved, 3);
  assert.match(kit.formatCompare(d), /1 regressed/);
});

test('compare: score deltas smaller than the noise are labelled as such', () => {
  const mk = (scores) => ({
    label: '',
    meta: { cases: 1, repeats: scores.length, attempts: scores.length, errors: 0 },
    results: scores.map((s, i) => ({ id: 'x', attempt: i + 1, pass: true, checks: [], score: s, ms: 1 })),
  });
  const small = kit.compare(mk([6, 8, 6, 8]), mk([7, 7.5, 6.5, 8]));
  assert.equal(small.rows[0].score.withinNoise, true);
  const big = kit.compare(mk([5, 5.2, 4.8]), mk([8, 8.2, 7.8]));
  assert.equal(big.rows[0].score.withinNoise, false);
});

test('compare: added and removed cases', () => {
  const mk = (id) => ({ meta: { cases: 1, repeats: 1, attempts: 1, errors: 0 }, results: [{ id, attempt: 1, pass: true, checks: [], ms: 1 }] });
  const d = kit.compare(mk('old'), mk('new'));
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
});

test('CLI: run → compare with --fail-on-regression exits 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-eval-'));
  const bin = path.join(ROOT, 'bin', 'llm-eval.js');
  const ex = (...p) => path.join(ROOT, 'examples', ...p);
  for (const v of ['v1', 'v2']) {
    execFileSync(process.execPath, [bin, 'run', '--cases', ex('cases.jsonl'), '--bot', ex('bots', `${v}.js`), '--repeats', '2', '--out', path.join(dir, `${v}.json`)]);
  }
  const report = execFileSync(process.execPath, [bin, 'report', path.join(dir, 'v1.json')]).toString();
  assert.match(report, /8 cases × 2 repeats = 16 attempts/);
  let code = 0;
  try {
    execFileSync(process.execPath, [bin, 'compare', path.join(dir, 'v1.json'), path.join(dir, 'v2.json'), '--fail-on-regression'], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- multi-turn replay ----------------------------------------------------
const { runConversationChecks } = require('../src/conversation.js');
const convs = kit.loadCases(path.join(ROOT, 'examples', 'conversations.jsonl'));
const modelA = require('../examples/bots/model-a.js');
const modelB = require('../examples/bots/model-b.js');

test('multi-turn: cases validate turns', () => {
  assert.equal(convs.length, 5);
  assert.throws(() => kit.validateCases([{ id: 'x', turns: [] }]), /non-empty/);
  assert.throws(() => kit.validateCases([{ id: 'x', turns: [{ recorded: 'hi' }] }]), /turn 1 has no "user"/);
});

test('multi-turn: the ranking flips between recorded and own history', async () => {
  const rate = async (bot, history) => kit.summarize(await kit.runSuite({ cases: convs, bot, history })).passRate;
  assert.equal(await rate(modelA, 'recorded'), 0.8);
  assert.equal(await rate(modelB, 'recorded'), 1);
  assert.equal(await rate(modelA, 'own'), 0.8);
  assert.equal(await rate(modelB, 'own'), 0.6);
});

test('multi-turn: the bot receives its own replies as history by default', async () => {
  const seen = [];
  const bot = async (input, { history, turn }) => {
    seen.push({ turn, history });
    return `reply ${turn}`;
  };
  await kit.runSuite({ cases: [{ id: 'c', turns: [{ user: 'a', recorded: 'HUMAN' }, 'b'] }], bot });
  assert.deepEqual(seen[1].history, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'reply 1' }]);
  seen.length = 0;
  await kit.runSuite({ cases: [{ id: 'c', turns: [{ user: 'a', recorded: 'HUMAN' }, 'b'] }], bot, history: 'recorded' });
  assert.equal(seen[1].history[1].content, 'HUMAN');
});

test('multi-turn: recorded history without a recorded reply is an error, not a silent pass', async () => {
  const run = await kit.runSuite({ cases: [{ id: 'c', turns: ['a', 'b'] }], bot: async () => 'x', history: 'recorded' });
  assert.equal(run.meta.errors, 1);
  assert.match(run.results[0].error, /no "recorded" reply/);
});

test('multi-turn: per-turn checks are labelled by turn and failures explain themselves', async () => {
  const run = await kit.runSuite({ cases: convs, bot: modelB });
  const s = kit.summarize(run);
  const road = s.cases.find((c) => c.id === 'buy-road');
  assert.deepEqual(Object.keys(road.failedChecks).sort(), ['conversation:noRepeatedQuestion', 'turn4:contains']);
  assert.match(kit.formatSummary(s), /asked twice: "how much would you like to spend\?" \(turns 1 and 2\)/);
  assert.match(kit.formatSummary(s, { transcripts: true }), /\[2\] user: Around 3000/);
});

test('conversation checks: repeated questions in Arabic, late handoff, unknown checks', () => {
  const t = (...replies) => replies.map((reply, i) => ({ turn: i + 1, user: 'u', reply }));
  const [rep] = runConversationChecks(t('كم ميزانيتك؟', 'تمام. كم ميزانيتك؟'), { noRepeatedQuestion: true });
  assert.equal(rep.pass, false);
  const [late] = runConversationChecks(t('a', 'b', 'ok [HANDOFF]'), { handoffBy: { turn: 2 } });
  assert.match(late.detail, /at turn 3, expected by turn 2/);
  const [some] = runConversationChecks(t('Price is 40', 'Bye'), { containsSomewhere: ['price', 'bye'] });
  assert.equal(some.pass, true);
  const [unk] = runConversationChecks(t('a'), { noRepeatedQuestoin: true });
  assert.equal(unk.pass, false);
});

test('multi-turn: the judge gets the whole transcript', async () => {
  let got;
  const judge = async (args) => {
    got = args;
    return { score: 7 };
  };
  await kit.runSuite({ cases: [{ id: 'c', turns: ['hi', 'bye'], rubric: 'polite' }], bot: async (i) => `echo ${i}`, judge });
  assert.equal(got.transcript.length, 2);
  assert.deepEqual(got.input, ['hi', 'bye']);
});
