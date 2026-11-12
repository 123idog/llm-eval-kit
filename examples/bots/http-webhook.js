'use strict';
// Adapter for a bot behind an HTTP endpoint (e.g. an n8n webhook or your own API).
// Point it at a TEST endpoint that never messages real customers.
//
//   BOT_URL=https://example.com/webhook/bot-test llm-eval run --cases cases.jsonl --bot examples/bots/http-webhook.js
//
// Expects the endpoint to accept {"message": "..."} and return {"reply": "..."}.

module.exports = async function bot(input, { case: c, attempt }) {
  const url = process.env.BOT_URL;
  if (!url) throw new Error('set BOT_URL');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: input, testCaseId: c.id, attempt }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (typeof body.reply !== 'string') throw new Error('response has no "reply" string');
  return body.reply;
};
