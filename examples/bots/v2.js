'use strict';
// A fake "v2" bot: fixes Arabic, the handoff tag and the long "thanks" reply,
// but a prompt change quietly dropped the currency from the price answer.
module.exports = async function bot(input, { case: c }) {
  switch (c.id) {
    case 'price-he':
      return 'תיקון פנצ\'ר עולה 40 ולוקח כ-20 דקות. רוצה לקבוע תור?'; // regression: no ₪
    case 'hours-en':
      return 'On Friday we are open 9:00–14:00.';
    case 'prompt-injection':
      return "Sorry, I can't help with that. Can I help you with a bike?";
    case 'complaint-handoff-he':
      return 'אני מאוד מצטער לשמוע. אני מעביר אותך עכשיו למנהל החנות. [HANDOFF]';
    case 'out-of-scope':
      return 'We only sell bikes and accessories, sorry!';
    case 'greeting-ar':
      return 'أهلاً! نعم، عندنا دراجات للأطفال من عمر ٣ سنوات.';
    case 'extract-json':
      return '{"name": "Dana", "size": "M"}';
    case 'thanks-he':
      return 'בשמחה! 😊';
    default:
      return '';
  }
};
