import {
  colorIndex,
  documentTables,
  fontIndex,
  otherWords,
  type Tables,
  writeHeader,
} from './rich-text-header.ts';
import { escapeText } from './rtf-text.ts';
import {
  same,
  type Border,
  type Borders,
  type CharacterFormat,
  type Formatting,
  type ParagraphFormat,
  type RichDocument,
  type RichParagraph,
  type Run,
  type TableRow,
} from './rich-text.ts';

/** The formatting a document's header leaves: nothing set, and `\uc0`. */
export const AFTER_HEADER: Formatting = { character: {}, unicodeSkip: 0 };

/** Writes rich text as RTF, as macOS writes it, from the model alone. */
export function writeRichText(document: RichDocument): string {
  const tables = documentTables(document);
  let rtf = writeHeader(document, tables);
  let formatting = AFTER_HEADER;
  for (const paragraph of document.paragraphs) {
    const written = writeParagraph(paragraph, formatting, tables);
    rtf += written.rtf;
    formatting = written.after;
  }
  return `${rtf}}`;
}

/** RTF written, and the formatting in effect after it. */
export interface Written {
  rtf: string;
  after: Formatting;
}

/** The words that put `to` in effect where `from` is: `\uc`, then character, then paragraph. */
export function changeFormatting(from: Formatting, to: Formatting, tables: Tables): string {
  let rtf = from.unicodeSkip === to.unicodeSkip ? '' : `\\uc${to.unicodeSkip} `;
  rtf += characterChange(from.character, to.character, tables);
  if (to.paragraph && !same(to.paragraph, from.paragraph)) {
    rtf += `\\pard${paragraphWords(to.paragraph)}\n`;
  }
  return rtf;
}

/** A paragraph as macOS writes it, where `before` is in effect; its text needs no `\uc`. */
export function writeParagraph(
  paragraph: RichParagraph,
  before: Formatting,
  tables: Tables,
): Written {
  let rtf = before.unicodeSkip === 0 ? '' : '\\uc0 ';
  if (paragraph.row) rtf += rowWords(paragraph.row, tables);
  if (!same(paragraph.format, before.paragraph)) {
    rtf += `\\pard${paragraphWords(paragraph.format)}\n`;
  }
  let character = before.character;
  // A list marker's group restores the formatting after it.
  if (paragraph.marker) rtf += `{\\listtext${writeRuns(paragraph.marker, character, tables).rtf}}`;
  const runs = writeRuns(paragraph.content, character, tables);
  rtf += runs.rtf + characterChange(runs.character, paragraph.end.format, tables);
  character = { ...paragraph.end.format };
  const { kind, lastRow } = paragraph.end;
  const ends = {
    paragraph: '\\\n',
    cell: '\\cell \n',
    row: `\\cell ${lastRow ? '\\lastrow' : ''}\\row\n`,
    nestcell: '\\nestcell \n',
    nestrow: `\\nestcell ${lastRow ? '\\lastrow' : ''}\\nestrow\n`,
    document: '',
  };
  return {
    rtf: rtf + ends[kind],
    after: { character, paragraph: paragraph.format, unicodeSkip: 0 },
  };
}

/** Runs written where `character` is in effect, and the character formatting they leave. */
function writeRuns(
  runs: Run[],
  character: CharacterFormat,
  tables: Tables,
): { rtf: string; character: CharacterFormat } {
  let rtf = '';
  let current = character;
  let index = 0;
  const writeRun = ({ text, format: { picture, ...format } }: Run) => {
    const written = picture ? picture.rtf.repeat(text.length) : escapeText(text);
    rtf += characterChange(current, format, tables) + written;
    current = { ...format };
  };
  while (index < runs.length) {
    const field = runs[index]!.format.field;
    if (field === undefined) {
      writeRun(runs[index]!);
      index += 1;
      continue;
    }
    // Runs in one field share its instruction; the field's group restores the formatting.
    const outside = current;
    rtf += `{\\field{\\*\\fldinst{${escapeText(field)}}}{\\fldrslt `;
    while (index < runs.length && runs[index]!.format.field === field) {
      writeRun(runs[index]!);
      index += 1;
    }
    rtf += '}}';
    current = outside;
  }
  return { rtf, character: current };
}

/** The words that take the character formatting from `current` to `format`. */
function characterChange(
  current: CharacterFormat,
  format: CharacterFormat,
  tables: Tables,
): string {
  const { field: _, ...wanted } = format;
  const { field: __, ...from } = current;
  if (same(wanted, from)) return '';
  // RTF cannot unset a word, only start over: so where something set is no longer, `\plain`.
  const restart = loses(from, wanted);
  return `\n${restart ? '\\plain ' : ''}${characterWords(wanted, restart ? {} : from, tables)}`;
}

/** The formats whose parts can be set one at a time, and so be left unset one at a time. */
const PARTED = new Set(['underline', 'strike', 'stroke', 'other']);

/** Whether going from `current` to `wanted` leaves unset something `current` sets. */
function loses(current: object, wanted: object): boolean {
  const wantedEntries = new Map<string, unknown>(Object.entries(wanted));
  return Object.entries(current).some(([key, value]) => {
    const next = wantedEntries.get(key);
    if (next === undefined) return true;
    if (!PARTED.has(key) || typeof value !== 'object' || value === null) return false;
    return typeof next === 'object' && next !== null && loses(value, next);
  });
}

function characterWords(format: CharacterFormat, from: CharacterFormat, tables: Tables): string {
  const words: string[] = [];
  const changed = (key: keyof CharacterFormat) => !same(format[key], from[key]);
  const color = (value: Parameters<typeof colorIndex>[1]) => colorIndex(tables, value);
  if (format.font && changed('font')) words.push(`f${fontIndex(tables, format.font)}`);
  if (format.size !== undefined && changed('size')) {
    const half = format.size * 2;
    words.push(
      Number.isInteger(half)
        ? `fs${half}`
        : `fs${Math.round(half)}\\fsmilli${Math.round(format.size * 1000)}`,
    );
  }
  if (format.bold !== undefined && changed('bold')) words.push(format.bold ? 'b' : 'b0');
  if (format.italic !== undefined && changed('italic')) words.push(format.italic ? 'i' : 'i0');
  if (format.underline && changed('underline')) {
    words.push(format.underline.style === 'none' ? 'ulnone' : format.underline.style);
    if (format.underline.color !== undefined) words.push(`ulc${color(format.underline.color)}`);
  }
  if (format.strike && changed('strike')) {
    words.push(format.strike.style === 'none' ? 'strike0' : format.strike.style);
    if (format.strike.color !== undefined) words.push(`strikec${color(format.strike.color)}`);
  }
  if (format.color !== undefined && changed('color')) words.push(`cf${color(format.color)}`);
  if (format.background !== undefined && changed('background')) {
    words.push(`cb${color(format.background)}`);
  }
  if (format.highlight !== undefined && changed('highlight')) {
    words.push(`highlight${color(format.highlight)}`);
  }
  if (format.expand && changed('expand')) {
    words.push(`expnd${format.expand.quarterPoints}`, `expndtw${format.expand.twips}`);
  }
  if (format.kerning !== undefined && changed('kerning')) words.push(`kerning${format.kerning}`);
  if (format.baseline !== undefined && changed('baseline')) {
    words.push(format.baseline < 0 ? `dn${-format.baseline}` : `up${format.baseline}`);
  }
  if (format.script && changed('script')) {
    words.push(format.script === 'none' ? 'nosupersub' : format.script);
  }
  if (format.outline !== undefined && changed('outline'))
    words.push(format.outline ? 'outl' : 'outl0');
  if (format.shadow !== undefined && changed('shadow'))
    words.push(format.shadow ? 'shad' : 'shad0');
  if (format.stroke && changed('stroke')) {
    if (format.stroke.width !== undefined) words.push(`strokewidth${format.stroke.width}`);
    if (format.stroke.color !== undefined) words.push(`strokec${color(format.stroke.color)}`);
  }
  for (const [name, value] of Object.entries(format.other ?? {})) {
    if (from.other?.[name] !== value) words.push(`${name}${value === true ? '' : value}`);
  }
  return words.map((word) => `\\${word} `).join('');
}

/** A table row's layout, as macOS writes it: the row, then each cell to its right edge. */
function rowWords(row: TableRow, tables: Tables): string {
  const border = (name: string, value: Border | undefined) => {
    if (!value) return '';
    const style = value.style ? `\\${value.style}` : '';
    const width = value.width === undefined ? '' : `\\brdrw${value.width}`;
    const colour = value.color === undefined ? '' : `\\brdrcf${colorIndex(tables, value.color)}`;
    return `\\${name}${style}${width}${colour} `;
  };
  const borders = (prefix: string, value: Borders) =>
    (['top', 'left', 'bottom', 'right'] as const)
      .map((side) => border(`${prefix}brdr${side[0]}`, value[side]))
      .join('');
  let words = `\\itap${row.depth}\\trowd `;
  if (row.flags !== undefined) words += `\\taflags${row.flags} `;
  if (row.gap !== undefined) words += `\\trgaph${row.gap}`;
  if (row.left !== undefined) words += `\\trleft${row.left} `;
  if (row.autofit !== undefined) words += `\\trautofit${row.autofit ? 1 : 0} `;
  if (row.lastRow) words += '\\lastrow ';
  words += borders('tr', row.borders) + otherWords(row.other);
  for (const cell of row.cells) {
    words += '\n';
    if (cell.verticalAlign) {
      words += { top: '\\clvertalt ', center: '\\clvertalc ', bottom: '\\clvertalb ' }[
        cell.verticalAlign
      ];
    }
    if (cell.background !== undefined) {
      words += `\\clcbpat${colorIndex(tables, cell.background)} `;
    }
    if (cell.noShading) words += '\\clshdrawnil ';
    if (cell.merge) {
      words += { first: '\\clmgf ', rest: '\\clmrg ', top: '\\clvmgf ', below: '\\clvmrg ' }[
        cell.merge
      ];
    }
    words += borders('cl', cell.borders);
    for (const [side, value] of Object.entries(cell.padding)) {
      words += `\\clpad${side[0]}${value} `;
    }
    if (cell.width?.value !== undefined) words += `\\clwWidth${cell.width.value}`;
    if (cell.width?.units !== undefined) words += `\\clftsWidth${cell.width.units} `;
    words += otherWords(cell.other);
    words += `${cell.gap ? '\\gaph' : ''}\\cellx${cell.right}`;
  }
  return `${words}\n`;
}

function paragraphWords(format: ParagraphFormat): string {
  const words: string[] = [];
  if (format.table?.inTable) words.push('intbl');
  if (format.table) words.push(`itap${format.table.depth}`);
  for (const tab of format.tabs ?? [])
    words.push(`${tab.kind ?? ''}${tab.kind ? '\\' : ''}tx${tab.position}`);
  if (format.defaultTab !== undefined) words.push(`pardeftab${format.defaultTab}`);
  if (format.leftIndent !== undefined) words.push(`li${format.leftIndent}`);
  if (format.firstIndent !== undefined) words.push(`fi${format.firstIndent}`);
  if (format.rightIndent !== undefined) words.push(`ri${format.rightIndent}`);
  if (format.lineSpacing)
    words.push(`sl${format.lineSpacing.twips}`, `slmult${format.lineSpacing.multiple}`);
  if (format.spaceBefore !== undefined) words.push(`sb${format.spaceBefore}`);
  if (format.spaceAfter !== undefined) words.push(`sa${format.spaceAfter}`);
  if (format.alignment)
    words.push({ left: 'ql', center: 'qc', right: 'qr', justified: 'qj' }[format.alignment]);
  if (format.naturalDirection) words.push('pardirnatural');
  if (format.tightenFactor !== undefined) words.push(`partightenfactor${format.tightenFactor}`);
  if (format.list) words.push(`ls${format.list.override}`, `ilvl${format.list.level}`);
  return words.map((word) => `\\${word}`).join('');
}
