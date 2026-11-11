import type { RtfGroup, RtfToken } from './rtf-syntax.ts';
import type { Color, Font, ListDefinition, ListLevel, ListOverride } from './rich-text.ts';
import { decodeByte, firstWord, numberOf, plainText, settingOf, skipFallback } from './rtf-text.ts';

/** The fonts of a `{\\fonttbl…}`, in order, and by the number text names them with. */
export function readFonts(table: RtfGroup): { fonts: Font[]; numbers: Map<number, Font> } {
  const fonts: Font[] = [];
  const numbers = new Map<number, Font>();
  // Entries are either `\f0\fswiss Helvetica;` in a row, or each in a group of its own.
  let font: Font | undefined;
  let number = 0;
  const entry = (tokens: RtfToken[]) => {
    for (const token of tokens) {
      if (token.kind === 'group') {
        entry(token.tokens);
      } else if (token.kind === 'control') {
        if (token.word === 'f') {
          number = token.parameter ?? 0;
          font = { name: '', family: 'nil' };
        } else if (font && token.word.startsWith('f') && FAMILIES.has(token.word.slice(1))) {
          font.family = token.word.slice(1);
        } else if (font && token.word === 'fcharset') {
          font.charset = token.parameter ?? 0;
        } else if (font && token.word !== 'fonttbl') {
          (font.other ??= {})[token.word] = token.parameter ?? true;
        }
      } else if (font && (token.kind === 'text' || token.kind === 'hex')) {
        const text = token.kind === 'hex' ? decodeByte(token.byte) : token.text;
        const [name, ...rest] = text.split(';');
        font.name += name!.replace(/^\s+/, '');
        if (rest.length > 0) {
          numbers.set(number, font);
          fonts.push(font);
          font = undefined;
        }
      }
    }
  };
  entry(table.tokens);
  return { fonts, numbers };
}

/** The colours of a `{\\colortbl…}`, `null` for the automatic colour's empty entry. */
export function readColors(table: RtfGroup): (Color | null)[] {
  const colors: (Color | null)[] = [];
  let color: Partial<Color> = {};
  for (const token of table.tokens.slice(1)) {
    if (
      token.kind === 'control' &&
      (token.word === 'red' || token.word === 'green' || token.word === 'blue')
    ) {
      color[token.word] = token.parameter ?? 0;
    } else if (token.kind === 'text') {
      for (const _ of token.text.matchAll(/;/g)) {
        colors.push(
          Object.keys(color).length === 0
            ? null
            : { red: color.red ?? 0, green: color.green ?? 0, blue: color.blue ?? 0 },
        );
        color = {};
      }
    }
  }
  return colors;
}

/** Each colour's exact colour space and values, from a `{\\*\\expandedcolortbl…}`, by number. */
export function readExpandedColors(table: RtfGroup): Color['expanded'][] {
  const entries: Color['expanded'][] = [];
  let space: string | undefined;
  let values: number[] = [];
  for (const token of table.tokens.slice(1)) {
    if (token.kind === 'control' && token.word === 'c') values.push(token.parameter ?? 0);
    else if (token.kind === 'control') space = token.word;
    else if (token.kind === 'text') {
      for (const _ of token.text.matchAll(/;/g)) {
        entries.push(space === undefined ? undefined : { space, values });
        space = undefined;
        values = [];
      }
    }
  }
  return entries;
}

const FAMILIES = new Set(['nil', 'swiss', 'roman', 'modern', 'script', 'decor', 'tech', 'bidi']);

/** The lists of a `{\*\listtable…}`. */
export function readLists(table: RtfGroup): ListDefinition[] {
  return table.tokens.flatMap((token): ListDefinition[] => {
    if (token.kind !== 'group' || firstWord(token) !== 'list') return [];
    const list: ListDefinition = { id: 0, hybrid: false, name: '', levels: [] };
    for (const part of token.tokens.slice(1)) {
      if (part.kind === 'group' && firstWord(part) === 'listlevel') {
        list.levels.push(readLevel(part));
      } else if (part.kind === 'group' && firstWord(part) === 'listname') {
        list.name = plainText(part.tokens.slice(1)).replace(/;$/, '').trim();
      } else if (part.kind === 'control') {
        if (part.word === 'listid') list.id = numberOf(part);
        else if (part.word === 'listtemplateid') list.templateId = numberOf(part);
        else if (part.word === 'listhybrid') list.hybrid = true;
        else (list.other ??= {})[part.word] = settingOf(part);
      }
    }
    return [list];
  });
}

/** One `{\listlevel…}`. */
function readLevel(group: RtfGroup): ListLevel {
  const level: ListLevel = { numberFormat: 0, text: { parts: [] } };
  const numbers: Record<string, keyof ListLevel> = {
    levelnfcn: 'numberFormatN',
    leveljc: 'justification',
    leveljcn: 'justificationN',
    levelfollow: 'follow',
    levelstartat: 'startAt',
    levelspace: 'space',
    levelindent: 'indent',
    fi: 'firstIndent',
    li: 'leftIndent',
    lin: 'lineIndent',
  };
  for (const part of group.tokens.slice(1)) {
    if (part.kind === 'control') {
      const value = numberOf(part);
      const key = numbers[part.word];
      if (part.word === 'levelnfc') level.numberFormat = value;
      else if (key !== undefined) Object.assign(level, { [key]: value });
      else (level.other ??= {})[part.word] = settingOf(part);
    } else if (part.kind === 'group') {
      const word = firstWord(part);
      if (word === 'levelmarker') level.marker = plainText(part.tokens.slice(1)).replace(/^ /, '');
      else if (word === 'leveltext') level.text = readLevelText(part);
    }
  }
  return level;
}

/** A level's `{\leveltext…}`: its length, then text with a byte below 10 for each level number. */
function readLevelText(group: RtfGroup): ListLevel['text'] {
  const text: ListLevel['text'] = { parts: [] };
  let written = '';
  // A `\u` character stands in for the next `\uc` characters, which are left out.
  let unicodeSkip = 1;
  let skipping = 0;
  const add = (chars: string) => {
    const skipped = skipFallback(chars, skipping);
    written += skipped.kept;
    ({ skipping } = skipped);
  };
  for (const token of group.tokens.slice(1)) {
    if (token.kind === 'control' && token.word === 'leveltemplateid') {
      text.templateId = numberOf(token);
    } else if (token.kind === 'control' && token.word === 'uc') {
      unicodeSkip = numberOf(token, 1);
    } else if (token.kind === 'control' && token.word === 'u') {
      const code = numberOf(token);
      written += String.fromCharCode(code < 0 ? code + 65_536 : code);
      skipping = unicodeSkip;
    } else if (token.kind === 'hex') {
      // Bytes below 32 are the text's length and its level numbers, not characters.
      add(token.byte < 32 ? String.fromCharCode(token.byte) : decodeByte(token.byte));
    } else if (token.kind === 'text') add(token.text);
  }
  const length = written.charCodeAt(0);
  for (const char of written.slice(1, 1 + length)) {
    const code = char.charCodeAt(0);
    const last = text.parts.at(-1);
    if (code < 10) text.parts.push({ level: code });
    else if (typeof last === 'string') text.parts[text.parts.length - 1] = last + char;
    else text.parts.push(char);
  }
  return text;
}

/** The overrides of a `{\*\listoverridetable…}`. */
export function readListOverrides(table: RtfGroup): ListOverride[] {
  return table.tokens.flatMap((token): ListOverride[] => {
    if (token.kind !== 'group' || firstWord(token) !== 'listoverride') return [];
    const override: ListOverride = { listId: 0, count: 0, override: 0 };
    for (const part of token.tokens) {
      if (part.kind !== 'control') continue;
      if (part.word === 'listid') override.listId = numberOf(part);
      else if (part.word === 'listoverridecount') override.count = numberOf(part);
      else if (part.word === 'ls') override.override = numberOf(part);
    }
    return [override];
  });
}
