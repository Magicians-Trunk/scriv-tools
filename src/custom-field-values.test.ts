import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  checkboxValue,
  isChecked,
  listValueName,
  pickerDate,
  storedDate,
} from './custom-field-values.ts';
import type { CustomField } from './scrivx.ts';

const field = (change: Partial<CustomField>): CustomField => ({
  id: 'f',
  type: 'Text',
  title: 'F',
  ...change,
});

describe('a checkbox', () => {
  const ticked = field({ type: 'Checkbox', defaultChecked: true });

  it('follows the default until an item sets it', () => {
    expect(isChecked(ticked, undefined)).toBe(true);
    expect(isChecked(field({ type: 'Checkbox' }), undefined)).toBe(false);
    expect(isChecked(ticked, 'No')).toBe(false);
    expect(isChecked(field({ type: 'Checkbox' }), 'Yes')).toBe(true);
  });

  it('stores Yes and No', () => {
    expect([checkboxValue(true), checkboxValue(false)]).toEqual(['Yes', 'No']);
  });
});

describe('a list value', () => {
  const list = field({
    type: 'List',
    listOptions: { none: 'All', options: [{ id: '1', name: 'Windows Only' }] },
  });

  it('prints its option, or the name for none', () => {
    expect(listValueName(list, '1')).toBe('Windows Only');
    expect(listValueName(list, undefined)).toBe('All');
    expect(listValueName(list, '9')).toBe('All');
  });

  it('prints nothing for a field with no options', () => {
    expect(listValueName(field({}), '1')).toBe('');
  });
});

describe('a date', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the zone east or west of UTC', () => {
    const date = field({ type: 'Date' });
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(330);
    expect(storedDate(date, '2026-10-05T15:02:00')).toMatch(/ -0530$/);
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-120);
    expect(storedDate(date, '2026-10-05T15:02:00')).toMatch(/ \+0200$/);
  });

  it("stores what is picked with this machine's zone, as Scrivener 3.5 does", () => {
    const stored = storedDate(field({ type: 'Date' }), '2026-10-05T15:02:09');
    expect(stored).toMatch(/^2026-10-05 15:02:09\.00000 [+-]\d{4}$/);
    expect(pickerDate(stored)).toBe('2026-10-05T15:02:09');
  });

  it("reads a zone as this machine's time", () => {
    const local = new Date(Date.UTC(2026, 9, 5, 13, 2));
    const shown = pickerDate('2026-10-05 15:02:00.00000 +0200');
    expect(new Date(shown).getTime()).toBe(local.getTime());
  });

  it('reads a zone west of UTC and one with no fraction', () => {
    const shown = pickerDate('2022-01-20 17:37:28 -0530');
    expect(new Date(shown).getTime()).toBe(Date.UTC(2022, 0, 20, 23, 7, 28));
  });

  it('stores no zone in a field that ignores them, and reads it unmoved', () => {
    const stored = storedDate(field({ type: 'Date', absolute: true }), '2022-01-20T17:37');
    expect(stored).toBe('2022-01-20 17:37:00');
    expect(pickerDate(stored)).toBe('2022-01-20T17:37:00');
  });

  it('shows nothing for what is not a date', () => {
    expect(pickerDate('next Tuesday')).toBe('');
  });
});
