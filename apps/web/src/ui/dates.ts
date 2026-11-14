/**
 * Every date the web app shows, in one of three forms: the day, the day and its
 * time, or the distance from now. Components format dates only through these.
 */

type When = Date | number | string;

const toDate = (at: When) => (at instanceof Date ? at : new Date(at));
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const yearDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function daysApart(day: Date, now: Date): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(day) - start(now)) / 86_400_000);
}

/** "today", "yesterday", "tomorrow", "Mon 3 Nov", or "Mon 3 Nov 2025" outside the current year. */
export function formatDay(at: When, now: When = new Date()): string {
  const day = toDate(at);
  const today = toDate(now);
  const apart = daysApart(day, today);
  if (apart === 0) return 'today';
  if (apart === -1) return 'yesterday';
  if (apart === 1) return 'tomorrow';
  return (day.getFullYear() === today.getFullYear() ? dayFormat : yearDayFormat).format(day);
}

/** "14:05" today, otherwise its day first: "tomorrow 09:00", "Thu 13 Nov 13:00". */
export function formatDayTime(at: When, now: When = new Date()): string {
  const day = toDate(at);
  const time = timeFormat.format(day);
  return daysApart(day, toDate(now)) === 0 ? time : `${formatDay(day, now)} ${time}`;
}

/** "in 2 h 14 min", "in 3 days", "4 min ago". */
export function formatRelative(at: When, now: When = new Date()): string {
  const diff = toDate(at).getTime() - toDate(now).getTime();
  const future = diff >= 0;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  let text: string;
  if (minutes < 1) return future ? 'in under a minute' : 'just now';
  if (minutes < 60) text = `${minutes} min`;
  else if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    text = m && h < 10 ? `${h} h ${m} min` : `${h} h`;
  } else text = `${Math.round(minutes / 1440)} days`;
  return future ? `in ${text}` : `${text} ago`;
}
