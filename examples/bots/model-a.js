'use strict';
// Fake "model A": reads the WHOLE conversation to know what the customer already said.
// Its flaw: answers a Hebrew opening-hours question in English.

const said = (history, input) => [...history.filter((m) => m.role === 'user').map((m) => m.content), input].join('\n');

module.exports = async function modelA(input, { history = [] } = {}) {
  if (/manager|human|person/i.test(input)) return "Sorry about that. I'm passing you to a team member now. [HANDOFF]";
  if (/broken|damaged/i.test(input)) return "I'm sorry to hear that! Could you send a photo of the wheel?";
  if (/פתוחים|שעות/.test(input)) return "We're open Sunday to Friday, 09:00 to 18:00.";
  if (/עולה|מחיר/.test(input)) return "תיקון פנצ'ר עולה 40 ₪ ולוקח בערך חצי שעה.";

  const all = said(history, input);
  const budget = /\b\d{3,5}\b/.exec(all);
  const type = /road|mountain/i.exec(all);
  const size = /\b[4-6]\d\b/.exec(all.replace(/\b\d{3,5}\b/g, ''));
  if (!budget) return "What's your budget?";
  if (!type) return 'Road or mountain bike?';
  if (!size) return 'What frame size do you ride?';
  const model = type[0].toLowerCase() === 'road' ? 'Aero R' : 'Trail X';
  return `I recommend the ${model} in size ${size[0]}. It fits your budget and you can test-ride it in the shop.`;
};
