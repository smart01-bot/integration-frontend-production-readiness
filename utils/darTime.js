/**
 * Timezone utilities — audit gap 25.
 *
 * The event runs in Dar es Salaam (EAT, UTC+3, no DST). Several controllers
 * computed calendar days with `new Date().toISOString().slice(0, 10)`, which
 * is UTC: between 21:00–24:00 UTC (midnight–3am in Dar) "today" resolved to
 * the wrong day. Every calendar-day comparison in the backend must use the
 * helpers below.
 */

export const DAR_TZ = 'Africa/Dar_es_Salaam';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAR_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/**
 * Today's calendar date in Dar as YYYY-MM-DD.
 * (en-CA locale yields exactly ISO format.)
 */
export function darToday() {
  return dateFmt.format(new Date());
}

/**
 * A Dar calendar date offset by N days (negative for the past).
 */
export function darDateOffset(days) {
  return dateFmt.format(new Date(Date.now() + days * 86400000));
}
