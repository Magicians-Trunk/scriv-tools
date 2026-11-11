/** The words of RTF that set a paragraph's formatting, or a run's. */
import type { CharacterFormat, Color, Font, ParagraphFormat } from './rich-text.ts';

const UNDERLINES = new Set([
  'ul',
  'uld',
  'uldash',
  'uldashd',
  'uldashdd',
  'uldb',
  'ulth',
  'ulw',
  'ulwave',
  'ulhwave',
  'ululdbwave',
  'ulthd',
  'ulthdash',
]);

/** Sets a paragraph word into `format`; false when the word is not one. */
export function paragraphWord(
  format: ParagraphFormat,
  word: string,
  parameter: number | undefined,
): boolean {
  const value = parameter ?? 0;
  switch (word) {
    case 'ql':
    case 'qc':
    case 'qr':
    case 'qj':
      format.alignment = ({ ql: 'left', qc: 'center', qr: 'right', qj: 'justified' } as const)[
        word
      ];
      return true;
    case 'pardeftab':
      format.defaultTab = value;
      return true;
    case 'li':
      format.leftIndent = value;
      return true;
    case 'fi':
      format.firstIndent = value;
      return true;
    case 'ri':
      format.rightIndent = value;
      return true;
    case 'sb':
      format.spaceBefore = value;
      return true;
    case 'sa':
      format.spaceAfter = value;
      return true;
    case 'sl':
      format.lineSpacing = { twips: value, multiple: format.lineSpacing?.multiple ?? 0 };
      return true;
    case 'slmult':
      format.lineSpacing = { twips: format.lineSpacing?.twips ?? 0, multiple: value };
      return true;
    case 'pardirnatural':
      format.naturalDirection = true;
      return true;
    case 'partightenfactor':
      format.tightenFactor = value;
      return true;
    case 'ls':
      format.list = { override: value, level: format.list?.level ?? 0 };
      return true;
    case 'ilvl':
      format.list = { override: format.list?.override ?? 0, level: value };
      return true;
    case 'intbl':
      format.table = { depth: format.table?.depth ?? 1, inTable: true };
      return true;
    case 'itap':
      format.table = { depth: value, inTable: format.table?.inTable ?? false };
      return true;
    default:
      return false;
  }
}

/** Sets a character word into `format`. */
export function characterWord(
  format: CharacterFormat,
  word: string,
  parameter: number | undefined,
  fonts: Map<number, Font>,
  colors: (Color | null)[],
): void {
  const on = parameter !== 0;
  const color = (index: number | undefined) => colors[index ?? 0] ?? null;
  switch (word) {
    case 'f': {
      const number = parameter ?? 0;
      const font = fonts.get(number);
      // A font the table does not list stays as its number.
      if (font) format.font = font;
      else (format.other ??= {}).f = number;
      return;
    }
    case 'fs':
      format.size = (parameter ?? 24) / 2;
      return;
    case 'fsmilli':
      format.size = (parameter ?? 12_000) / 1000;
      return;
    case 'b':
      format.bold = on;
      return;
    case 'i':
      format.italic = on;
      return;
    case 'ulnone':
      format.underline = { style: 'none' };
      return;
    case 'ulc':
      format.underline = { style: format.underline?.style ?? 'ul', color: color(parameter) };
      return;
    case 'strike':
    case 'striked':
      format.strike = on ? { style: word, color: format.strike?.color } : { style: 'none' };
      if (format.strike.color === undefined) delete format.strike.color;
      return;
    case 'strikec':
      format.strike = { style: format.strike?.style ?? 'strike', color: color(parameter) };
      return;
    case 'cf':
      format.color = color(parameter);
      return;
    case 'cb':
      format.background = color(parameter);
      return;
    case 'highlight':
      format.highlight = color(parameter);
      return;
    case 'expnd':
      format.expand = { quarterPoints: parameter ?? 0, twips: format.expand?.twips ?? 0 };
      return;
    case 'expndtw':
      format.expand = { quarterPoints: format.expand?.quarterPoints ?? 0, twips: parameter ?? 0 };
      return;
    case 'kerning':
      format.kerning = parameter ?? 0;
      return;
    case 'up':
      format.baseline = parameter ?? 6;
      return;
    case 'dn':
      format.baseline = -(parameter ?? 6);
      return;
    case 'super':
    case 'sub':
      format.script = word;
      return;
    case 'nosupersub':
      format.script = 'none';
      return;
    case 'outl':
      format.outline = on;
      return;
    case 'shad':
      format.shadow = on;
      return;
    case 'strokewidth':
      format.stroke = { ...format.stroke, width: parameter ?? 0 };
      return;
    case 'strokec':
      format.stroke = { ...format.stroke, color: color(parameter) };
      return;
    default:
      if (UNDERLINES.has(word)) {
        format.underline = on ? { style: word, ...pick(format.underline) } : { style: 'none' };
        return;
      }
      (format.other ??= {})[word] = parameter ?? true;
  }
}

const pick = (underline: CharacterFormat['underline']) =>
  underline?.color === undefined ? {} : { color: underline.color };

/** A copy of the format with nothing empty in it, to compare and to keep. */
export function cleanCharacter(format: CharacterFormat): CharacterFormat {
  const copy: CharacterFormat = { ...format };
  if (copy.other) copy.other = { ...copy.other };
  return copy;
}

export function cleanParagraph(format: ParagraphFormat): ParagraphFormat {
  const copy: ParagraphFormat = { ...format };
  if (copy.tabs) copy.tabs = [...copy.tabs];
  return copy;
}
