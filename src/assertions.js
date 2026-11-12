'use strict';

/**
 * Deterministic checks on a reply. Each returns { pass, detail }.
 * A case lists them under "expect", e.g.
 *   { "contains": ["price"], "notContains": ["as an AI"], "maxChars": 400, "language": "hebrew" }
 */

const SCRIPTS = {
  hebrew: /[א-ת]/gu,
  arabic: /[ؠ-يٱ-ۓ]/gu,
  latin: /[A-Za-zÀ-ɏ]/gu,
};

const norm = (s) => String(s ?? '').toLowerCase();
const list = (v) => (Array.isArray(v) ? v : [v]);
const count = (s, re) => (String(s).match(re) || []).length;

function dominantScript(text) {
  let best = 'none';
  let max = 0;
  for (const [name, re] of Object.entries(SCRIPTS)) {
    const n = count(text.replace(/https?:\/\/\S+/g, ''), re);
    if (n > max) [best, max] = [name, n];
  }
  return best;
}

const assertions = {
  contains(reply, expected) {
    const missing = list(expected).filter((e) => !norm(reply).includes(norm(e)));
    return { pass: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : '' };
  },
  containsAny(reply, expected) {
    const ok = list(expected).some((e) => norm(reply).includes(norm(e)));
    return { pass: ok, detail: ok ? '' : `none of: ${list(expected).join(', ')}` };
  },
  notContains(reply, forbidden) {
    const found = list(forbidden).filter((e) => norm(reply).includes(norm(e)));
    return { pass: found.length === 0, detail: found.length ? `found: ${found.join(', ')}` : '' };
  },
  regex(reply, pattern) {
    const ok = list(pattern).every((p) => new RegExp(p, 'iu').test(reply));
    return { pass: ok, detail: ok ? '' : `no match for ${list(pattern).join(' | ')}` };
  },
  notRegex(reply, pattern) {
    const hit = list(pattern).find((p) => new RegExp(p, 'iu').test(reply));
    return { pass: !hit, detail: hit ? `matched ${hit}` : '' };
  },
  maxChars(reply, n) {
    const len = String(reply).length;
    return { pass: len <= n, detail: len <= n ? '' : `${len} chars > ${n}` };
  },
  minChars(reply, n) {
    const len = String(reply).length;
    return { pass: len >= n, detail: len >= n ? '' : `${len} chars < ${n}` };
  },
  language(reply, lang) {
    const d = dominantScript(String(reply));
    return { pass: d === lang, detail: d === lang ? '' : `dominant script is ${d}, expected ${lang}` };
  },
  json(reply, shouldBeJson = true) {
    let ok = true;
    try {
      JSON.parse(reply);
    } catch {
      ok = false;
    }
    return { pass: ok === shouldBeJson, detail: ok === shouldBeJson ? '' : ok ? 'is JSON' : 'not valid JSON' };
  },
  equals(reply, expected) {
    const ok = String(reply).trim() === String(expected).trim();
    return { pass: ok, detail: ok ? '' : 'not equal' };
  },
};

/**
 * Run every check listed in `expect` against `reply`.
 * @returns {Array<{check:string, pass:boolean, detail:string}>}
 */
function runAssertions(reply, expect = {}) {
  const out = [];
  for (const [name, arg] of Object.entries(expect)) {
    const fn = assertions[name];
    if (!fn) {
      out.push({ check: name, pass: false, detail: `unknown check "${name}"` });
      continue;
    }
    out.push({ check: name, ...fn(reply, arg) });
  }
  return out;
}

module.exports = { assertions, runAssertions, dominantScript };
