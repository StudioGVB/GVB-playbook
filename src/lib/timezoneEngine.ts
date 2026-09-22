export const TIMEZONE_PRESETS = [
  { value: 'Europe/London', label: 'Europe/London (UK - Manchester / London)' },
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEST / AEDT)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST / AEDT)' },
  { value: 'Australia/Brisbane', label: 'Australia/Brisbane (AEST)' },
  { value: 'Australia/Perth', label: 'Australia/Perth (AWST)' },
  { value: 'America/New_York', label: 'America/New_York (US Eastern)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

/**
 * Converts a raw timestamp string or Date object from a source bank timezone to a target living timezone.
 * Handles Up Bank timestamps e.g. "2026-09-22T16:30:00" in Australia/Melbourne -> UK local date/time.
 */
export function recalibrateBankTimestamp(
  postedAt: string | Date | null | undefined,
  bankTimezone: string = 'Australia/Melbourne',
  livingTimezone: string = 'Europe/London'
): Date {
  if (!postedAt) return new Date();

  let dateObj: Date;

  if (postedAt instanceof Date) {
    dateObj = postedAt;
  } else {
    let str = String(postedAt).trim();

    // If naive date format without explicit UTC offset e.g. "2026-09-22 16:30:00" or "2026-09-22T16:30:00"
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(str)) {
      const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, y, m, d, hh, mm, ss] = match.map(Number);
        dateObj = createDateInTimezone(y, m, d, hh, mm, ss, bankTimezone);
      } else {
        dateObj = new Date(str);
      }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        const [, y, m, d] = match.map(Number);
        dateObj = createDateInTimezone(y, m, d, 12, 0, 0, bankTimezone);
      } else {
        dateObj = new Date(str);
      }
    } else {
      dateObj = new Date(str);
    }
  }

  if (isNaN(dateObj.getTime())) return new Date();
  return dateObj;
}

/**
 * Helper to construct a JavaScript Date object for a given local date-time components in a specific IANA timezone.
 */
function createDateInTimezone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ianaTimezone: string
): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  const naiveIso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;

  try {
    const utcDate = new Date(`${naiveIso}Z`);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(utcDate);
    const map: Record<string, string> = {};
    parts.forEach(p => { map[p.type] = p.value; });

    const tzYear = parseInt(map.year, 10);
    const tzMonth = parseInt(map.month, 10);
    const tzDay = parseInt(map.day, 10);
    const tzHour = parseInt(map.hour === '24' ? '0' : map.hour, 10);
    const tzMin = parseInt(map.minute, 10);
    const tzSec = parseInt(map.second, 10);

    const tzAsUtc = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMin, tzSec);
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const offsetMs = tzAsUtc - utcDate.getTime();

    return new Date(targetAsUtc - offsetMs);
  } catch (err) {
    return new Date(`${naiveIso}Z`);
  }
}

/**
 * Formats a Date object cleanly into the target timezone string format.
 */
export function formatInTimezone(
  date: Date,
  targetTimezone: string = 'Europe/London',
  pattern: 'ISO' | 'DATE_ONLY' | 'DISPLAY' = 'DISPLAY'
): string {
  if (isNaN(date.getTime())) return '';

  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  parts.forEach(p => { map[p.type] = p.value; });

  const year = map.year;
  const month = map.month;
  const day = map.day;
  const hour = map.hour === '24' ? '00' : map.hour;
  const minute = map.minute;
  const second = map.second;

  if (pattern === 'DATE_ONLY') {
    return `${year}-${month}-${day}`;
  }

  if (pattern === 'ISO') {
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }

  const monthName = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10))
    .toLocaleString('en-GB', { month: 'short' });

  return `${day} ${monthName} ${hour}:${minute}`;
}
