/** What an item holds in a custom field, in the forms Scrivener writes. */
import type { CustomField } from './scrivx.ts';

/** `2026-10-05 15:02:00.00000 +0200`, or with no zone in a field that ignores time zones. */
const STORED_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?(?: ([+-]\d{2})(\d{2}))?$/;

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** A date in this machine's time, as a date and time picker holds it. */
const pickerTime = (date: Date) =>
  `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}` +
  `T${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;

/** A date's offset from UTC, as Scrivener writes it. */
function zoneOf(date: Date): string {
  const east = -date.getTimezoneOffset();
  const minutes = Math.abs(east);
  const sign = east < 0 ? '-' : '+';
  return `${sign}${twoDigits(Math.floor(minutes / 60))}${twoDigits(minutes % 60)}`;
}

/** Whether a checkbox is ticked for an item.  One never set follows the field's default. */
export function isChecked({ defaultChecked }: CustomField, value: string | undefined): boolean {
  return value === undefined ? defaultChecked === true : value === 'Yes';
}

/** A checkbox's value. */
export const checkboxValue = (checked: boolean) => (checked ? 'Yes' : 'No');

/** What an item's list field prints: its option's name, or the field's name for none. */
export function listValueName({ listOptions }: CustomField, value: string | undefined): string {
  const option = listOptions?.options.find(({ id }) => id === value);
  return option?.name ?? listOptions?.none ?? '';
}

/**
 * A stored date as a date and time picker holds it, or nothing for one Scrivener would not have
 * written.  A date with a zone reads in this machine's time, as Scrivener shows it.
 */
export function pickerDate(stored: string): string {
  const parts = STORED_DATE.exec(stored);
  if (!parts) return '';
  const [, day, time, hours, minutes] = parts;
  if (hours === undefined) return `${day}T${time}`;
  return pickerTime(new Date(`${day}T${time}${hours}:${minutes}`));
}

/** A picked date as Scrivener stores it for this field. */
export function storedDate({ absolute }: CustomField, picked: string): string {
  const date = new Date(picked);
  const [day, time] = pickerTime(date).split('T');
  return absolute === true ? `${day} ${time}` : `${day} ${time}.00000 ${zoneOf(date)}`;
}
