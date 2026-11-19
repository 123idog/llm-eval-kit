'use strict';

// Checks over a whole conversation (multi-turn cases), as opposed to one reply.
// transcript: [{ turn, user, reply }]

const normalize = (s) => s.toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim();

function questionsIn(text) {
  return (String(text).match(/[^.!?\n؟]*[?؟]/g) || []).map((q) => q.trim()).filter(Boolean);
}

const conversationChecks = {
  // The assistant asks the same question in two different turns: it lost track of what was said.
  noRepeatedQuestion(transcript, enabled) {
    if (!enabled) return { pass: true, detail: 'skipped' };
    const seen = new Map();
    for (const t of transcript) {
      for (const q of new Set(questionsIn(t.reply).map(normalize))) {
        if (!q) continue;
        if (seen.has(q)) return { pass: false, detail: `asked twice: "${q}?" (turns ${seen.get(q)} and ${t.turn})` };
        seen.set(q, t.turn);
      }
    }
    return { pass: true, detail: `${seen.size} distinct questions` };
  },

  // A handoff marker must appear by turn N (e.g. the customer asked for a human).
  handoffBy(transcript, { marker = '[HANDOFF]', turn } = {}) {
    const hit = transcript.find((t) => String(t.reply).includes(marker));
    if (!hit) return { pass: false, detail: `no ${marker} in ${transcript.length} turns` };
    if (turn && hit.turn > turn) return { pass: false, detail: `${marker} at turn ${hit.turn}, expected by turn ${turn}` };
    return { pass: true, detail: `${marker} at turn ${hit.turn}` };
  },

  // Each listed string must appear in at least one reply of the conversation.
  containsSomewhere(transcript, needles) {
    const all = transcript.map((t) => String(t.reply).toLowerCase()).join('\n');
    const missing = [].concat(needles).filter((n) => !all.includes(String(n).toLowerCase()));
    return { pass: !missing.length, detail: missing.length ? `never said: ${missing.join(', ')}` : 'ok' };
  },

  maxTurns(transcript, n) {
    return { pass: transcript.length <= n, detail: `${transcript.length} turns` };
  },
};

function runConversationChecks(transcript, expect) {
  if (!expect) return [];
  return Object.entries(expect).map(([name, arg]) => {
    const fn = conversationChecks[name];
    if (!fn) return { check: `conversation:${name}`, pass: false, detail: `unknown check "${name}"` };
    return { check: `conversation:${name}`, ...fn(transcript, arg) };
  });
}

module.exports = { runConversationChecks, conversationChecks, questionsIn };
