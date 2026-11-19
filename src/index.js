'use strict';

const fs = require('fs');
const { runAssertions, assertions } = require('./assertions');
const { runConversationChecks } = require('./conversation');

/**
 * Load test cases from a .jsonl file (one case per line) or a .json array.
 * A single-turn case: { id, input, expect?, rubric?, tags? }
 * A multi-turn case:  { id, turns: ["text" | { user, expect?, recorded? }], expectConversation?, rubric? }
 */
function loadCases(file) {
  const text = fs.readFileSync(file, 'utf8');
  const cases = file.endsWith('.jsonl')
    ? text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('//')).map((l, i) => {
        try {
          return JSON.parse(l);
        } catch (e) {
          throw new Error(`${file}:${i + 1}: ${e.message}`);
        }
      })
    : JSON.parse(text);
  validateCases(cases);
  return cases;
}

function validateCases(cases) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('no cases');
  const ids = new Set();
  for (const c of cases) {
    if (!c || c.id === undefined) throw new Error('every case needs an "id"');
    if (ids.has(c.id)) throw new Error(`duplicate case id "${c.id}"`);
    ids.add(c.id);
    if (c.turns !== undefined) {
      if (!Array.isArray(c.turns) || !c.turns.length) throw new Error(`case "${c.id}": "turns" must be a non-empty array`);
      c.turns.forEach((t, i) => {
        const user = typeof t === 'string' ? t : t && t.user;
        if (typeof user !== 'string') throw new Error(`case "${c.id}" turn ${i + 1} has no "user" text`);
      });
    } else if (c.input === undefined) throw new Error(`case "${c.id}" has no "input" or "turns"`);
  }
}

function withTimeout(promise, ms) {
  if (!ms) return promise;
  let t;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

async function pool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

const turnOf = (t) => (typeof t === 'string' ? { user: t } : t);

/**
 * Play a multi-turn case. Each turn the bot gets the user's message plus the history so far.
 * history "own":      the bot's OWN earlier replies (what really happens in production)
 * history "recorded": the replies recorded in the case (what most single-turn evals implicitly test)
 */
async function playConversation(c, bot, { attempt, history, timeoutMs }) {
  const messages = [];
  const transcript = [];
  const checks = [];
  for (let i = 0; i < c.turns.length; i++) {
    const t = turnOf(c.turns[i]);
    const ctx = { case: c, attempt, turn: i + 1, history: messages.map((m) => ({ ...m })) };
    const raw = await withTimeout(Promise.resolve(bot(t.user, ctx)), timeoutMs);
    const reply = typeof raw === 'string' ? raw : JSON.stringify(raw);
    transcript.push({ turn: i + 1, user: t.user, reply });
    for (const x of runAssertions(reply, t.expect)) checks.push({ ...x, check: `turn${i + 1}:${x.check}` });
    messages.push({ role: 'user', content: t.user });
    if (history === 'recorded' && i < c.turns.length - 1) {
      if (typeof t.recorded !== 'string') throw new Error(`case "${c.id}" turn ${i + 1} has no "recorded" reply (needed for --history recorded)`);
      messages.push({ role: 'assistant', content: t.recorded });
    } else {
      messages.push({ role: 'assistant', content: reply });
    }
  }
  checks.push(...runConversationChecks(transcript, c.expectConversation));
  return { transcript, checks };
}

/**
 * Run every case `repeats` times against `bot`.
 *
 * @param {object} opts
 * @param {Array} opts.cases
 * @param {(input:any, ctx:{case:object, attempt:number}) => Promise<string>|string} opts.bot
 * @param {(args:{input:any, reply:string, case:object}) => Promise<{score:number, reason?:string}>} [opts.judge]
 *        optional LLM-as-judge (or any scorer); called only for cases with a "rubric"
 * @param {number} [opts.repeats=1]      run each case N times to measure noise
 * @param {number} [opts.concurrency=2]
 * @param {number} [opts.timeoutMs=60000]
 * @param {string} [opts.label]          e.g. "v2" or a prompt revision
 * @param {'own'|'recorded'} [opts.history='own']  history used for multi-turn cases
 */
async function runSuite(opts) {
  const { cases, bot, judge, repeats = 1, concurrency = 2, timeoutMs = 60000, label = '', history = 'own' } = opts;
  if (history !== 'own' && history !== 'recorded') throw new Error('history must be "own" or "recorded"');
  validateCases(cases);
  if (typeof bot !== 'function') throw new TypeError('bot must be a function');

  const tasks = [];
  for (const c of cases) {
    for (let attempt = 1; attempt <= repeats; attempt++) {
      tasks.push(async () => {
        const started = Date.now();
        const r = { id: c.id, attempt, reply: null, ms: 0, error: null, checks: [], pass: false };
        try {
          if (c.turns) {
            const conv = await playConversation(c, bot, { attempt, history, timeoutMs });
            r.transcript = conv.transcript;
            r.reply = conv.transcript[conv.transcript.length - 1].reply;
            r.checks = conv.checks;
          } else {
            const reply = await withTimeout(Promise.resolve(bot(c.input, { case: c, attempt })), timeoutMs);
            r.reply = typeof reply === 'string' ? reply : JSON.stringify(reply);
            r.checks = runAssertions(r.reply, c.expect);
          }
          if (judge && c.rubric) {
            try {
              const j = await withTimeout(Promise.resolve(judge({ input: c.input ?? c.turns.map((t) => turnOf(t).user), reply: r.reply, transcript: r.transcript, case: c })), timeoutMs);
              r.score = Number(j.score);
              r.judgeReason = j.reason || '';
            } catch (e) {
              r.judgeError = e.message;
            }
          }
          r.pass = r.checks.every((x) => x.pass);
        } catch (e) {
          r.error = e.message;
        }
        r.ms = Date.now() - started;
        return r;
      });
    }
  }

  const results = await pool(tasks, concurrency);
  return {
    label,
    startedAt: new Date().toISOString(),
    meta: { cases: cases.length, repeats, attempts: results.length, errors: results.filter((r) => r.error).length, history },
    results,
  };
}

function stats(nums) {
  if (!nums.length) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
  return { n: nums.length, mean: round(mean), sd: round(sd), min: Math.min(...nums), max: Math.max(...nums) };
}

const round = (x) => Math.round(x * 100) / 100;

/**
 * Per-case and overall numbers. Always reports the denominator.
 */
function summarize(run) {
  const byCase = new Map();
  for (const r of run.results) {
    if (!byCase.has(r.id)) byCase.set(r.id, []);
    byCase.get(r.id).push(r);
  }
  const cases = [];
  for (const [id, rs] of byCase) {
    const ok = rs.filter((r) => !r.error);
    const passed = ok.filter((r) => r.pass).length;
    const failedChecks = {};
    for (const r of ok) for (const c of r.checks) if (!c.pass) failedChecks[c.check] = (failedChecks[c.check] || 0) + 1;
    const scores = ok.map((r) => r.score).filter((s) => typeof s === 'number' && !Number.isNaN(s));
    const firstFail = ok.find((r) => !r.pass);
    cases.push({
      id,
      firstFailure: firstFail
        ? {
            attempt: firstFail.attempt,
            checks: firstFail.checks.filter((c) => !c.pass).map((c) => ({ check: c.check, detail: c.detail })),
            transcript: firstFail.transcript,
            reply: firstFail.reply,
          }
        : null,
      attempts: rs.length,
      errors: rs.length - ok.length,
      passRate: ok.length ? round(passed / ok.length) : 0,
      flaky: passed > 0 && passed < ok.length,
      failedChecks,
      score: stats(scores),
      medianMs: median(rs.map((r) => r.ms)),
    });
  }
  const valid = run.results.filter((r) => !r.error);
  const allScores = cases.filter((c) => c.score).map((c) => c.score);
  return {
    label: run.label,
    denominator: `${run.meta.cases} cases × ${run.meta.repeats} repeats = ${run.meta.attempts} attempts, ${run.meta.errors} errors`,
    passRate: valid.length ? round(valid.filter((r) => r.pass).length / valid.length) : 0,
    casesAlwaysPassing: cases.filter((c) => c.passRate === 1).length,
    casesFlaky: cases.filter((c) => c.flaky).map((c) => c.id),
    // Average within-case spread of judge scores: the noise floor for comparing versions.
    scoreNoise: allScores.length ? round(allScores.reduce((a, s) => a + s.sd, 0) / allScores.length) : null,
    cases,
  };
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Compare a baseline run with a candidate run, case by case.
 * A score change is "within noise" when it is no bigger than the larger of the two runs' spreads for that case.
 */
function compare(baseRun, candRun) {
  const a = summarize(baseRun);
  const b = summarize(candRun);
  const A = new Map(a.cases.map((c) => [c.id, c]));
  const B = new Map(b.cases.map((c) => [c.id, c]));
  const rows = [];
  for (const id of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(id);
    const y = B.get(id);
    if (!x || !y) {
      rows.push({ id, status: x ? 'removed' : 'added' });
      continue;
    }
    let status = 'same';
    if (y.passRate < x.passRate) status = 'regressed';
    else if (y.passRate > x.passRate) status = 'improved';
    const row = { id, status, passRate: [x.passRate, y.passRate] };
    if (x.score && y.score) {
      const delta = round(y.score.mean - x.score.mean);
      const noise = Math.max(x.score.sd, y.score.sd);
      row.score = { base: x.score.mean, cand: y.score.mean, delta, withinNoise: Math.abs(delta) <= noise };
    }
    rows.push(row);
  }
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    base: { label: a.label, denominator: a.denominator, passRate: a.passRate },
    cand: { label: b.label, denominator: b.denominator, passRate: b.passRate },
    regressed: count('regressed'),
    improved: count('improved'),
    same: count('same'),
    added: count('added'),
    removed: count('removed'),
    rows,
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;

function formatSummary(s, { transcripts = false } = {}) {
  const lines = [];
  lines.push(`# Eval run${s.label ? `: ${s.label}` : ''}`, '');
  lines.push(`**${s.denominator}**`, '');
  lines.push(`- Pass rate: **${pct(s.passRate)}** (of attempts without errors)`);
  lines.push(`- Cases passing every attempt: ${s.casesAlwaysPassing} / ${s.cases.length}`);
  lines.push(`- Flaky cases: ${s.casesFlaky.length ? s.casesFlaky.join(', ') : 'none'}`);
  if (s.scoreNoise !== null) lines.push(`- Judge noise (mean within-case SD): ±${s.scoreNoise}`);
  lines.push('', '| Case | Pass rate | Failed checks | Score (mean ± sd) | Median ms |', '|---|---|---|---|---|');
  for (const c of s.cases) {
    const fails = Object.entries(c.failedChecks).map(([k, v]) => `${k}×${v}`).join(', ');
    const score = c.score ? `${c.score.mean} ± ${c.score.sd}` : '';
    const flag = c.flaky ? ' ⚠ flaky' : c.passRate === 1 ? '' : ' ✖';
    lines.push(`| ${c.id} | ${pct(c.passRate)}${flag}${c.errors ? ` (${c.errors} err)` : ''} | ${fails} | ${score} | ${c.medianMs} |`);
  }
  const failing = s.cases.filter((c) => c.firstFailure);
  if (failing.length) {
    lines.push('', '### Why they failed (first failing attempt)', '');
    for (const c of failing) {
      for (const x of c.firstFailure.checks) lines.push(`- **${c.id}** · ${x.check}: ${x.detail}`);
      if (transcripts) {
        const t = c.firstFailure.transcript || [{ turn: 1, user: '(input)', reply: c.firstFailure.reply }];
        lines.push('', '```text');
        for (const m of t) lines.push(`[${m.turn}] user: ${m.user}`, `    bot:  ${m.reply}`);
        lines.push('```', '');
      }
    }
  }
  return lines.join('\n');
}

function formatCompare(d) {
  const icon = { regressed: '🔴', improved: '🟢', same: '⚪', added: '➕', removed: '➖' };
  const lines = [];
  lines.push(`# Compare: ${d.base.label || 'base'} → ${d.cand.label || 'candidate'}`, '');
  lines.push(`- Base: ${d.base.denominator}, pass rate ${pct(d.base.passRate)}`);
  lines.push(`- Candidate: ${d.cand.denominator}, pass rate ${pct(d.cand.passRate)}`);
  lines.push(`- **${d.regressed} regressed**, ${d.improved} improved, ${d.same} same, ${d.added} added, ${d.removed} removed`);
  lines.push('', '| | Case | Pass rate | Judge score |', '|---|---|---|---|');
  const order = { regressed: 0, improved: 1, added: 2, removed: 3, same: 4 };
  for (const r of [...d.rows].sort((x, y) => order[x.status] - order[y.status])) {
    const pr = r.passRate ? `${pct(r.passRate[0])} → ${pct(r.passRate[1])}` : '';
    const sc = r.score ? `${r.score.base} → ${r.score.cand} (${r.score.delta >= 0 ? '+' : ''}${r.score.delta}${r.score.withinNoise ? ', within noise' : ''})` : '';
    lines.push(`| ${icon[r.status]} | ${r.id} | ${pr} | ${sc} |`);
  }
  return lines.join('\n');
}

module.exports = { loadCases, validateCases, runSuite, summarize, compare, formatSummary, formatCompare, assertions };
