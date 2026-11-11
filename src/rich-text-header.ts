/** A document's opening as macOS writes it: its settings, and its font, colour and list tables. */
import { escapeText } from './rtf-text.ts';
import { readRtfSyntax, type RtfToken } from './rtf-syntax.ts';
import {
  same,
  type CharacterFormat,
  type Color,
  type DocumentSettings,
  type Font,
  type ListDefinition,
  type ListLevel,
  type ListOverride,
  type RichDocument,
} from './rich-text.ts';

/**
 * The fonts and colours a document is written with: its own tables, then those its text uses
 * that they do not list.  A table with no colours still has the automatic colour, `null`.
 */
export interface Tables {
  fonts: Font[];
  colors: (Color | null)[];
}

/** The colours a character format uses. */
function colorsOf(format: CharacterFormat): (Color | null | undefined)[] {
  return [
    format.color,
    format.background,
    format.highlight,
    format.underline?.color,
    format.strike?.color,
    format.stroke?.color,
  ];
}

export function documentTables(document: RichDocument): Tables {
  const fonts = [...document.fonts];
  const colors: (Color | null)[] = document.colors.length > 0 ? [...document.colors] : [null];
  const formats = document.paragraphs.flatMap((paragraph) => [
    ...(paragraph.marker ?? []).map((run) => run.format),
    ...paragraph.content.map((run) => run.format),
    paragraph.end.format,
  ]);
  for (const format of formats) {
    if (format.font && !fonts.some((font) => same(font, format.font))) fonts.push(format.font);
    for (const color of colorsOf(format)) {
      if (color && !colors.some((known) => same(known, color))) colors.push(color);
    }
  }
  return { fonts, colors };
}

/** A colour's number in the tables; the automatic colour, 0, for none. */
export function colorIndex(tables: Tables, color: Color | null | undefined): number {
  return color ? tables.colors.findIndex((known) => same(known, color)) : 0;
}

export function fontIndex(tables: Tables, font: Font): number {
  return tables.fonts.findIndex((known) => same(known, font));
}

/** What macOS opens a document with, for one with no source and no project to take it from. */
const NEW_DOCUMENT: DocumentSettings = {
  rtf: 1,
  ansi: true,
  ansicpg: 1252,
  cocoartf: 2822,
  cocoatextscaling: 0,
  cocoaplatform: 0,
};

/** The words before the font table, in the order macOS writes them. */
const LEADING_SETTINGS = ['rtf', 'ansi', 'mac', 'pc', 'pca', 'ansicpg', 'cocoartf', 'cocoasubrtf'];

/** Words by name, as RTF: each a backslash, its name, its value, and a space. */
export function otherWords(other: Record<string, number | true> | undefined): string {
  return Object.entries(other ?? {})
    .map(([name, value]) => `${word(name, value)} `)
    .join('');
}

/** A word as RTF: a backslash, its name and its value. */
function word(name: string, value: number | true): string {
  return `\\${name}${value === true ? '' : value}`;
}

/**
 * The document's opening group and its settings and tables, up to its text: `\uc0` last, so
 * that what follows needs no fallback characters.
 */
export function writeHeader(document: RichDocument, tables: Tables): string {
  const settings = Object.keys(document.settings).length > 0 ? document.settings : NEW_DOCUMENT;
  const setting = (name: string) => {
    const value = settings[name];
    return value === undefined ? '' : word(name, value);
  };
  const rest = Object.keys(settings).filter((name) => !LEADING_SETTINGS.includes(name));
  const early = rest.filter((name) => name.startsWith('cocoa'));
  let rtf = `{${LEADING_SETTINGS.map(setting).join('')}\n${early.map(setting).join('')}`;
  rtf += `{\\fonttbl${tables.fonts.map(fontEntry).join('')}}\n`;
  rtf += `{\\colortbl${tables.colors.map(colorEntry).join('')}}\n`;
  if (tables.colors.some((color) => color?.expanded)) {
    rtf += `{\\*\\expandedcolortbl${tables.colors.map(expandedEntry).join('')}}\n`;
  }
  if (document.lists.length > 0) {
    rtf += `{\\*\\listtable${document.lists.map(listEntry).join('')}}\n`;
  }
  if (document.listOverrides.length > 0) {
    const entries = document.listOverrides.map(overrideEntry).join('');
    rtf += `{\\*\\listoverridetable${entries}}\n`;
  }
  const late = rest.filter((name) => !early.includes(name));
  return `${rtf}${late.map(setting).join('')}\\uc0\n`;
}

/** Entries to add to the end of a source's table, and whether the source must have that table. */
export interface AddedEntries {
  tokens: RtfToken[];
  needed: boolean;
  /** The whole table: it takes the place of the source's, or goes in when it has none. */
  table?: RtfToken[];
}

/**
 * The entries the tables list after the source's own `fonts` and `colors`, by table (`fonttbl`,
 * `colortbl`, `expandedcolortbl`), for the tables that have any to add.
 */
export function addedEntries(
  tables: Tables,
  fonts: number,
  colors: number,
  lists: Pick<RichDocument, 'lists' | 'listOverrides'> = { lists: [], listOverrides: [] },
): Map<string, AddedEntries> {
  const entries = new Map<string, AddedEntries>();
  if (lists.lists.length > 0) {
    const rtf = lists.lists.map(listEntry).join('');
    entries.set('listtable', {
      tokens: readRtfSyntax(rtf),
      needed: true,
      table: readRtfSyntax(`{\\*\\listtable${rtf}}\n`),
    });
  }
  if (lists.listOverrides.length > 0) {
    const rtf = lists.listOverrides.map(overrideEntry).join('');
    entries.set('listoverridetable', {
      tokens: readRtfSyntax(rtf),
      needed: true,
      table: readRtfSyntax(`{\\*\\listoverridetable${rtf}}\n`),
    });
  }
  const addedFonts = tables.fonts.slice(fonts);
  if (addedFonts.length > 0) {
    const rtf = addedFonts.map((font, index) => fontEntry(font, fonts + index)).join('');
    entries.set('fonttbl', { tokens: readRtfSyntax(rtf), needed: true });
  }
  const added = tables.colors.slice(colors);
  if (added.length > 0) {
    entries.set('colortbl', {
      tokens: readRtfSyntax(added.map(colorEntry).join('')),
      needed: true,
    });
    // Only an expanded colour needs the expanded table; where it is, every colour has a place.
    entries.set('expandedcolortbl', {
      tokens: readRtfSyntax(added.map(expandedEntry).join('')),
      needed: added.some((color) => color?.expanded),
    });
  }
  return entries;
}

function fontEntry(font: Font, index: number): string {
  const other = Object.entries(font.other ?? {})
    .map(([name, value]) => word(name, value))
    .join('');
  const charset = font.charset === undefined ? '' : `\\fcharset${font.charset}`;
  return `\\f${index}\\f${font.family}${charset}${other} ${escapeText(font.name)};`;
}

function colorEntry(color: Color | null): string {
  return color ? `\\red${color.red}\\green${color.green}\\blue${color.blue};` : ';';
}

function expandedEntry(color: Color | null): string {
  if (!color?.expanded) return ';';
  return `\\${color.expanded.space}${color.expanded.values.map((value) => `\\c${value}`).join('')};`;
}

/** A list override, as macOS writes it into its table. */
function overrideEntry({ listId, count, override }: ListOverride): string {
  return `{\\listoverride\\listid${listId}\\listoverridecount${count}\\ls${override}}`;
}

/** A list, as macOS writes it into its list table. */
function listEntry(list: ListDefinition): string {
  const template = list.templateId === undefined ? '' : `\\listtemplateid${list.templateId}`;
  const levels = list.levels.map(levelEntry).join('');
  return `{\\list${template}${list.hybrid ? '\\listhybrid' : ''}${otherWords(list.other)}${levels}{\\listname ${escapeText(list.name)};}\\listid${list.id}}`;
}

function levelEntry(level: ListLevel): string {
  const numbers: [string, number | undefined][] = [
    ['levelnfc', level.numberFormat],
    ['levelnfcn', level.numberFormatN],
    ['leveljc', level.justification],
    ['leveljcn', level.justificationN],
    ['levelfollow', level.follow],
    ['levelstartat', level.startAt],
    ['levelspace', level.space],
    ['levelindent', level.indent],
  ];
  let words = '{\\listlevel';
  for (const [name, value] of numbers) if (value !== undefined) words += word(name, value);
  if (level.marker !== undefined) words += `{\\*\\levelmarker ${escapeText(level.marker)}}`;
  // The text starts with its length; a level's number is the byte of the level.
  const parts = level.text.parts.map((part) =>
    typeof part === 'string' ? part : String.fromCharCode(part.level),
  );
  // Its length counts as the reader reads it, in UTF-16 units.
  const text = String.fromCharCode(parts.join('').length) + parts.join('');
  const template =
    level.text.templateId === undefined ? '' : `\\leveltemplateid${level.text.templateId}`;
  words += `{\\leveltext${template}${escapeLevelText(text)};}`;
  // Where each level number is in the text, counting its length as the first character.
  const places: number[] = [];
  let position = 1;
  for (const part of level.text.parts) {
    if (typeof part === 'string') position += part.length;
    else places.push(position++);
  }
  words += `{\\levelnumbers${places.map((place) => `\\'${place.toString(16).padStart(2, '0')}`).join('')};}`;
  for (const [name, value] of [
    ['fi', level.firstIndent],
    ['li', level.leftIndent],
    ['lin', level.lineIndent],
  ] as const) {
    if (value !== undefined) words += word(name, value);
  }
  return `${words}${otherWords(level.other)}}`;
}

/** A level's text, its control bytes as `\'hh`. */
function escapeLevelText(text: string): string {
  let written = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    written += code < 32 ? `\\'${code.toString(16).padStart(2, '0')}` : escapeText(char);
  }
  return written;
}
