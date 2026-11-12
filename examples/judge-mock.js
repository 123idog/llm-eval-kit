'use strict';
// A fake judge that behaves like a real LLM judge in one important way: it is noisy.
// Re-scoring the same reply gives a slightly different number each attempt.
// Replace with a call to your model: send the rubric, the input and the reply, ask for {score, reason}.
const rand = require('./bots/_rand');

let call = 0;
module.exports = async function judge({ reply, case: c }) {
  const base = c.id === 'complaint-handoff-he' && !reply.includes('[HANDOFF]') ? 5 : 8;
  const noise = (rand(c.id, reply, ++call) - 0.5) * 2; // ±1
  return { score: Math.round((base + noise) * 10) / 10, reason: 'mock' };
};
