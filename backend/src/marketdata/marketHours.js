// US equity regular session: Mon–Fri, 09:30–16:00 America/New_York. Uses Intl to
// resolve ET wall-clock (handles EST/EDT) without a date library. Holidays are
// not modeled — out of scope for Step 6a (the simulator covers any dead feed).
const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function isUsMarketOpen(date) {
  const parts = Object.fromEntries(ET.formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = parts.weekday; // 'Mon'..'Sun'
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

module.exports = { isUsMarketOpen };
