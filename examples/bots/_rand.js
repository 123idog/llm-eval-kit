'use strict';
// Deterministic pseudo-random number in [0,1) from a string, so the demo is reproducible
// while still showing run-to-run variation (different attempt → different value).
module.exports = function rand(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 10000) / 10000;
};
