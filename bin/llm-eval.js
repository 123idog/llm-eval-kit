#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const kit = require('../src/index.js');

const HELP = `Usage:
  llm-eval run     --cases <file.jsonl> --bot <bot.js> [--judge <judge.js>] [--repeats 3]
                   [--concurrency 2] [--timeout 60000] [--label v2] [--out run.json]
  llm-eval report  <run.json>
  llm-eval compare <base.json> <candidate.json> [--fail-on-regression]

bot.js   exports: async (input, { case, attempt }) => string
judge.js exports: async ({ input, reply, case }) => ({ score, reason })   (used for cases with "rubric")`;

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else out[key] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

const load = (p) => {
  const mod = require(path.resolve(p));
  return typeof mod === 'function' ? mod : mod.default || mod.bot || mod.judge;
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parse(rest);

  if (cmd === 'run') {
    if (!args.cases || !args.bot) throw new Error('run needs --cases and --bot');
    const run = await kit.runSuite({
      cases: kit.loadCases(args.cases),
      bot: load(args.bot),
      judge: args.judge ? load(args.judge) : undefined,
      repeats: Number(args.repeats || 1),
      concurrency: Number(args.concurrency || 2),
      timeoutMs: Number(args.timeout || 60000),
      label: args.label || path.basename(args.bot, '.js'),
    });
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(run, null, 2));
    console.log(kit.formatSummary(kit.summarize(run)));
    if (args.out) console.log(`\nSaved: ${args.out}`);
    return run.meta.errors > 0 ? 1 : 0;
  }
  if (cmd === 'report') {
    if (!args._[0]) throw new Error('report needs <run.json>');
    console.log(kit.formatSummary(kit.summarize(readJson(args._[0]))));
    return 0;
  }
  if (cmd === 'compare') {
    if (args._.length < 2) throw new Error('compare needs <base.json> <candidate.json>');
    const d = kit.compare(readJson(args._[0]), readJson(args._[1]));
    console.log(kit.formatCompare(d));
    return args['fail-on-regression'] && d.regressed > 0 ? 1 : 0;
  }
  console.log(HELP);
  return cmd === undefined || cmd === '-h' || cmd === '--help' ? 0 : 2;
}

main().then(
  (code) => (process.exitCode = code),
  (e) => {
    console.error(`llm-eval: ${e.message}`);
    process.exitCode = 2;
  }
);
