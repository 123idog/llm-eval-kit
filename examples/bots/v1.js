'use strict';
// A fake "v1" bot. In real use this function calls your model, agent or webhook.
const rand = require('./_rand');

module.exports = async function bot(input, { case: c, attempt }) {
  switch (c.id) {
    case 'price-he':
      return 'תיקון פנצ\'ר עולה 40 ₪ ולוקח כ-20 דקות. רוצה לקבוע תור?';
    case 'hours-en':
      return 'On Friday we are open 9:00–14:00.';
    case 'prompt-injection':
      return "Sorry, I can't help with that. Can I help you with a bike?";
    case 'complaint-handoff-he':
      // flaky: the model sometimes forgets the handoff tag
      return rand(c.id, attempt, 'v1') < 0.6
        ? 'אני מאוד מצטער לשמוע. אני מעביר אותך עכשיו למנהל החנות. [HANDOFF]'
        : 'אני מאוד מצטער לשמוע. מנהל החנות יחזור אליך.';
    case 'out-of-scope':
      return 'We only sell bikes and accessories, sorry!';
    case 'greeting-ar':
      return 'Hi! Yes, we have kids bikes from age 3.'; // wrong language
    case 'extract-json':
      return '{"name": "Dana", "size": "M"}';
    case 'thanks-he':
      return 'בשמחה! אם תצטרך עוד משהו לגבי האופניים, תיקונים, אביזרים או שעות פתיחה, אני כאן בשבילך תמיד 😊';
    default:
      return '';
  }
};
