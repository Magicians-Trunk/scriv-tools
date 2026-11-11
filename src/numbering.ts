import type { BinderItem } from './binder-item.ts';
import { UnsupportedError } from './unsupported.ts';

const UNITS = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

/** A number in an auto-numbering style: `n` 1, `r`/`R` i/I, `l`/`L` a/A, `w`/`W`/`t` one/ONE/One. */
export function formatNumber(type: string, value: number): string {
  switch (type) {
    case 'r':
      return roman(value);
    case 'R':
      return roman(value).toUpperCase();
    case 'l':
      return letters(value);
    case 'L':
      return letters(value).toUpperCase();
    case 'w':
      return words(value);
    case 'W':
      return words(value).toUpperCase();
    case 't': {
      const word = words(value);
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    default:
      return String(value);
  }
}

function roman(value: number): string {
  let rest = value;
  return ROMAN.map(([size, symbol]) => {
    const count = Math.floor(rest / size);
    rest -= count * size;
    return symbol.repeat(count);
  }).join('');
}

function letters(value: number): string {
  if (value > 26) throw new UnsupportedError('alphabetical numbering past z');
  return String.fromCharCode(96 + value);
}

function words(value: number): string {
  if (value > 99) throw new UnsupportedError('numbering in words past ninety-nine');
  if (value < 20) return UNITS[value]!;
  const unit = UNITS[value % 10]!;
  return TENS[Math.floor(value / 10)]! + (unit ? `-${unit}` : '');
}

/**
 * Hierarchical numbers, from each item's numbering kind (its first numbering placeholder).  An
 * item counts when it or anything inside it has a kind, and takes the kind of its first such item.  Each counted item moves its level
 * on by one and restarts the levels below; a change of kind restarts everything.
 */
export function hierarchicalNumbers(
  entries: { item: BinderItem; level: number; kind: string | undefined }[],
): Map<string, string> {
  const kinds = entries.map(({ kind }) => kind);
  entries.forEach(({ level }, index) => {
    for (let next = index + 1; next < entries.length && entries[next]!.level > level; next += 1) {
      kinds[index] ??= kinds[next];
    }
  });
  let counters: number[] = [];
  let current: string | undefined;
  const numbers = new Map<string, string>();
  entries.forEach(({ item, level }, index) => {
    const kind = kinds[index];
    if (kind === undefined) return;
    if (kind !== current) counters = [];
    current = kind;
    counters.length = level;
    counters[level - 1] = (counters[level - 1] ?? 0) + 1;
    const number = hierarchyNumber(kind, counters, level);
    if (number !== undefined) numbers.set(item.id, number);
  });
  return numbers;
}

/**
 * `<$hn>` 1.2, `<$hn_0>` 0.2, `<$ahn>` a.2, `<$hn_level1>` without the first level, and `<$aon>`
 * the item's own level in outline style (`A` at level 2, `1` at level 3).
 */
function hierarchyNumber(kind: string, counters: number[], level: number): string | undefined {
  const [first = 0, ...rest] = counters;
  if (kind === 'hn') return counters.join('.');
  if (kind === 'hn_0') return [first - 1, ...rest].join('.');
  if (kind === 'ahn') return [letters(first), ...rest].join('.');
  if (kind === 'hn_level1') return rest.join('.');
  if (kind === 'aon' && level === 2) return letters(counters[1]!).toUpperCase();
  if (kind === 'aon' && level === 3) return String(counters[2]);
  return undefined;
}
