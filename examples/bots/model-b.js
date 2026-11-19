'use strict';
// Fake "model B": decides the next step from the LAST assistant message only.
// With a human's recorded replies in the history, that works perfectly.
// With its own replies, it doesn't recognise its own wording of the budget question
// ("How much would you like to spend?"), so it asks it again, and again.
// Its Hebrew is better than model A's.

module.exports = async function modelB(input, { history = [] } = {}) {
  if (/manager|human|person/i.test(input)) return 'I understand. Connecting you with our team. [HANDOFF]';
  if (/broken|damaged/i.test(input)) return "I'm so sorry! Could you send a photo of the wheel?";
  if (/פתוחים|שעות/.test(input)) return 'בשישי אנחנו פתוחים 09:00–14:00, ובימים א׳–ה׳ 09:00–18:00.';
  if (/עולה|מחיר/.test(input)) return "תיקון פנצ'ר עולה 40 ₪.";

  const last = [...history].reverse().find((m) => m.role === 'assistant')?.content || '';
  if (/budget/i.test(last)) return 'Road or mountain bike?';
  if (/road or mountain/i.test(last)) return 'What frame size do you ride?';
  if (/frame size/i.test(last)) return `I recommend our best match in size ${input.trim()}.`;
  return 'How much would you like to spend?';
};
