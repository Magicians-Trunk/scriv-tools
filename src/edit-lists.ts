/** Lists in a document: starting one, joining one, and numbering one. */
import type { DocumentText } from './document.ts';
import type { Paragraph } from './edit-markers.ts';
import { writesNumber } from './grouping.ts';
import type { CharacterFormat, ListLevel, ParagraphFormat } from './rich-text.ts';
import { UnsupportedError } from './unsupported.ts';

/** What a list item is: whether its top level numbers, and how deep it sits, from 0. */
export interface ListShape {
  ordered: boolean;
  level: number;
}

/** Bullets Scrivener names in a list's marker, and the character each draws. */
const BULLETS: Record<string, string> = {
  disc: '•',
  circle: '◦',
  square: '▪',
  hyphen: '⁃',
  diamond: '◆',
  check: '✓',
};
/** The list table's bullet format (`\levelnfc23`). */
const BULLET_FORMAT = 23;
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

function roman(number: number): string {
  let left = number;
  let written = '';
  for (const [value, letters] of ROMAN) {
    while (left >= value) {
      written += letters;
      left -= value;
    }
  }
  return written;
}

/** Letters as a list counts them: a to z, then aa, ab. */
function alphabetic(number: number): string {
  const rest = Math.floor((number - 1) / 26);
  const letter = String.fromCharCode(97 + ((number - 1) % 26));
  return rest > 0 ? alphabetic(rest) + letter : letter;
}

/** Each number format this can write, by its `\levelnfc` and by the name a marker gives it. */
const NUMBERS = [
  { name: 'decimal', format: 0, write: String },
  { name: 'upper-roman', format: 1, write: (n: number) => roman(n).toUpperCase() },
  { name: 'lower-roman', format: 2, write: roman },
  { name: 'upper-alpha', format: 3, write: (n: number) => alphabetic(n).toUpperCase() },
  { name: 'lower-alpha', format: 4, write: alphabetic },
];

/** A marker as Scrivener writes one: text, `{name}`, text. */
const MARKER = /^(?<before>[^{]*)\{(?<name>[^}]+)\}(?<after>.*)$/;

/** Which kind of list a marker is, when it is one this can write. */
export function listKind(marker: string): 'bullet' | 'numbered' | undefined {
  const name = MARKER.exec(marker)?.groups?.name ?? '';
  if (BULLETS[name] !== undefined) return 'bullet';
  return NUMBERS.some((number) => number.name === name) ? 'numbered' : undefined;
}

/** A list level as Scrivener writes one, from its marker, for a list and a depth. */
function listLevel(marker: string, list: number, depth: number): ListLevel {
  const { before = '', name = '', after = '' } = MARKER.exec(marker)?.groups ?? {};
  const bullet = BULLETS[name];
  const number = NUMBERS.find((each) => each.name === name);
  if (bullet === undefined && !number) throw new UnsupportedError(`a list marked ${marker}`);
  const numberFormat = number?.format ?? BULLET_FORMAT;
  const middle = bullet ?? { level: depth };
  const left = 720 * (depth + 1);
  return {
    numberFormat,
    numberFormatN: numberFormat,
    justification: 0,
    justificationN: 0,
    follow: 0,
    startAt: 1,
    space: 360,
    indent: 0,
    marker,
    text: {
      templateId: (list - 1) * 100 + depth + 1,
      parts: [before, middle, after].filter((part) => part !== ''),
    },
    firstIndent: -360,
    leftIndent: left,
    lineIndent: left,
  };
}

/** A list item's marker: what its level writes for its number, between tabs. */
function itemMarker(level: ListLevel, number: number, format: CharacterFormat) {
  const write = NUMBERS.find((each) => each.format === level.numberFormat)?.write ?? String;
  const written = level.text.parts.map((part) => (typeof part === 'string' ? part : write(number)));
  return [{ text: `\t${written.join('')}\t`, format }];
}

/** Adds a new list to the document, and gives the override that names it. */
function addList(document: DocumentText, marker: string): number {
  const id = Math.max(0, ...document.lists.map((list) => list.id)) + 1;
  const override = Math.max(0, ...document.listOverrides.map((entry) => entry.override)) + 1;
  const levels = [listLevel(marker, id, 0)];
  document.lists.push({ id, templateId: id, hybrid: true, name: '', levels });
  document.listOverrides.push({ listId: id, count: 0, override });
  return override;
}

/** The list an override names. */
function listNamed(document: DocumentText, override: number) {
  const { listId } = document.listOverrides.find((entry) => entry.override === override)!;
  return document.lists.find((list) => list.id === listId)!;
}

/** What a paragraph is as a list item, when it is one its document's lists define. */
export function listShape(document: DocumentText, paragraph: Paragraph): ListShape | undefined {
  const { list } = paragraph.format;
  const entry = document.listOverrides.find(({ override }) => override === list?.override);
  const top = document.lists.find(({ id }) => id === entry?.listId)?.levels[0];
  return list && top ? { ordered: writesNumber(top), level: list.level } : undefined;
}

/** How a list item at a depth is set out, as Scrivener sets each level out. */
function levelFormat(level: number): ParagraphFormat {
  const left = 720 * (level + 1);
  return {
    tabs: [{ position: left - 500 }, { position: left }],
    defaultTab: 720,
    leftIndent: left,
    firstIndent: -left,
    naturalDirection: true,
    tightenFactor: 0,
  };
}

/**
 * Makes a paragraph a list item at a level: of the list beside it when there is one, else of a new
 * list.  A level the list does not have yet is a hyphen, as Scrivener's editor adds one.
 */
export function makeListItem(
  document: DocumentText,
  paragraph: Paragraph,
  marker: string,
  beside: Paragraph | undefined,
  character: CharacterFormat,
  level = 0,
): void {
  const override = beside?.format.list?.override ?? addList(document, marker);
  const list = listNamed(document, override);
  while (list.levels.length <= level) {
    list.levels.push(listLevel('{hyphen}', list.id, list.levels.length));
  }
  const nesting = level > 0 ? levelFormat(level) : {};
  paragraph.format = { ...paragraph.format, ...nesting, list: { override, level } };
  paragraph.marker = itemMarker(list.levels[level]!, 1, character);
}

/** Numbers a list in order: each level counts on, and starts over under the level above. */
function renumber(document: DocumentText, override: number): void {
  const { levels } = listNamed(document, override);
  const counts: number[] = [];
  for (const item of document.paragraphs) {
    const [first] = item.marker ?? [];
    const { list } = item.format;
    if (!first || list?.override !== override) continue;
    const level = levels[list.level];
    if (!level) continue;
    counts.length = list.level + 1;
    const count = (counts[list.level] ?? (level.startAt ?? 1) - 1) + 1;
    counts[list.level] = count;
    if (writesNumber(level)) item.marker = itemMarker(level, count, first.format);
  }
}

/** Numbers again the lists these paragraphs are in, which adding or removing them changed. */
export function renumberLists(document: DocumentText, paragraphs: Paragraph[]): void {
  const overrides = new Set(paragraphs.map(({ format }) => format.list?.override));
  for (const override of overrides) if (override !== undefined) renumber(document, override);
}
