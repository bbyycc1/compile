/** Natural-language date hints for the manual follow-up input.
 *  Parses things like "tomorrow", "this monday", "next fri", "9/16", "in 3 days"
 *  from free text. All resolution happens in America/Los_Angeles.
 *  Returns a yyyy-mm-dd string (for <input type="date">) or null.
 */

const TZ = 'America/Los_Angeles';

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** "Today" in LA as a plain {y,m,d}. */
function laToday(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function toISO(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

function addDays(base: { y: number; m: number; d: number }, n: number): string {
  const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + n));
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(base: { y: number; m: number; d: number }): number {
  return new Date(Date.UTC(base.y, base.m - 1, base.d)).getUTCDay();
}

export function parseDateHint(raw: string): string | null {
  const text = ` ${raw.toLowerCase().replace(/[.,!?;:'"]/g, ' ')} `;
  const today = laToday();
  const todayISO = toISO(today.y, today.m, today.d);

  // "today"
  if (/\btoday\b/.test(text)) return todayISO;
  // "tomorrow" / "tmr" / "tmrw"
  if (/\b(tomorrow|tmr|tmrw)\b/.test(text)) return addDays(today, 1);
  // "day after tomorrow"
  if (/day after tomorrow/.test(text)) return addDays(today, 2);
  // "in N days" / "in a day"
  {
    const m = text.match(/\bin (\d+) days?\b/) || text.match(/\bin a day\b/);
    if (m) return addDays(today, m[1] ? Number(m[1]) : 1);
  }
  // "in N weeks" / "in a week" / "next week"
  {
    const m = text.match(/\bin (\d+) weeks?\b/);
    if (m) return addDays(today, Number(m[1]) * 7);
    if (/\b(in a week|next week)\b/.test(text)) return addDays(today, 7);
  }
  // "this <weekday>" / "next <weekday>" / bare "<weekday>"
  {
    const m = text.match(/\b(this|next)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
    if (m) {
      const target = WEEKDAYS[m[2]];
      const cur = weekdayOf(today);
      let delta = (target - cur + 7) % 7; // nearest upcoming (0 = today)
      if (m[1] === 'next') delta += 7;
      // bare "friday" with delta 0 (today is friday) -> today is fine
      return addDays(today, delta);
    }
  }
  // "M/D" or "M-D" like 9/16, 10-1 (optionally with /yyyy)
  {
    const m = text.match(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12][0-9]|3[01])(?:[\/\-](\d{2,4}))?\b/);
    if (m) {
      let y = today.y;
      const mo = Number(m[1]);
      const d = Number(m[2]);
      if (m[3]) {
        y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
      } else {
        // if the date already passed this year, assume next year
        const candidate = toISO(y, mo, d);
        if (candidate < todayISO) y += 1;
      }
      // validate the day exists in that month
      const check = new Date(Date.UTC(y, mo - 1, d));
      if (check.getUTCMonth() !== mo - 1) return null;
      return toISO(y, mo, d);
    }
  }
  return null;
}
