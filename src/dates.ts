import { UnsupportedError } from './unsupported.ts';

/** Dates and times are written as Scrivener writes them on a Mac set to US English. */
export const LOCALE = 'en-US';

/** Date and time styles, by placeholder size. */
export const DATE_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'long' },
  full: { dateStyle: 'full' },
};

export const TIME_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  short: { timeStyle: 'short' },
  medium: { timeStyle: 'medium' },
};

export const TODAY: Record<string, Intl.DateTimeFormatOptions> = {
  year: { year: 'numeric' },
  shortdate: DATE_STYLES.short!,
  mediumdate: DATE_STYLES.medium!,
  longdate: DATE_STYLES.long!,
  fulldate: DATE_STYLES.full!,
  month: { month: 'long' },
  longmonth: { month: 'long' },
  shortmonth: { month: 'short' },
  numericalmonth: { month: '2-digit' },
  shortnumericalmonth: { month: 'numeric' },
  day: { day: 'numeric' },
  shortday: { day: 'numeric' },
  longday: { day: '2-digit' },
  weekday: { weekday: 'long' },
  longweekday: { weekday: 'long' },
  shortweekday: { weekday: 'short' },
};

/**
 * A date or time in US English, as macOS writes it: with a narrow no-break space before AM and
 * PM, whatever this machine's ICU uses.
 */
export function usDate(date: Date, style: Intl.DateTimeFormatOptions): string {
  return date.toLocaleString(LOCALE, style).replace(/\s(AM|PM)/g, `${NARROW_SPACE}$1`);
}

const NARROW_SPACE = String.fromCharCode(0x202f);

/** A binder date as Scrivener stores it (`2026-10-31 01:13:04 -0400`), in the time it was stored. */
export function stampDate(stamp: string): Date {
  const parts = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(stamp);
  if (!parts) throw new Error(`Unreadable binder date: "${stamp}"`);
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  return new Date(year!, month! - 1, day, hour, minute, second);
}

/** A number as two digits. */
const two = (value: number) => String(value).padStart(2, '0');

/** A date as Scrivener stamps one, in local time with its offset: `2026-10-31 01:13:04 -0400`. */
export function dateStamp(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const zone = `${sign}${two(Math.floor(Math.abs(offset) / 60))}${two(Math.abs(offset) % 60)}`;
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  const time = `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
  return `${day} ${time} ${zone}`;
}

/** The moment a stamp as `dateStamp` writes it names, to say which of two is later. */
export function stampTime(stamp: string): number {
  const [day, time, zone = ''] = stamp.split(' ');
  return Date.parse(`${day}T${time}${zone.slice(0, 3)}:${zone.slice(3)}`);
}

/** A date in a Unicode date pattern such as `yyyy-MM-dd HH:mm`. */
export function formatDate(date: Date, pattern: string): string {
  const fields: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    yy: String(date.getFullYear()).slice(2),
    MMMM: date.toLocaleString(LOCALE, { month: 'long' }),
    MMM: date.toLocaleString(LOCALE, { month: 'short' }),
    MM: twoDigits(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    dd: twoDigits(date.getDate()),
    d: String(date.getDate()),
    HH: twoDigits(date.getHours()),
    H: String(date.getHours()),
    mm: twoDigits(date.getMinutes()),
    ss: twoDigits(date.getSeconds()),
  };
  return pattern.replace(/'[^']*'|([A-Za-z])\1*/g, (token) => {
    if (token.startsWith("'")) return token.slice(1, -1);
    const value = fields[token];
    if (value === undefined) throw new UnsupportedError(`date pattern ${token}`);
    return value;
  });
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
