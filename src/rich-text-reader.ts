import { hexBytes } from './files.ts';
import {
  readRtfSyntax,
  type RtfControl,
  type RtfGroup,
  type RtfToken,
  writeRtfSyntax,
} from './rtf-syntax.ts';
import {
  characterWord,
  cleanCharacter,
  cleanParagraph,
  paragraphWord,
} from './rich-text-format.ts';
import { ROW_WORDS, RowReader } from './rich-text-rows.ts';
import {
  readColors,
  readExpandedColors,
  readFonts,
  readListOverrides,
  readLists,
} from './rich-text-tables.ts';
import {
  CONTROL_SYMBOLS,
  SYMBOL_WORDS,
  codePageReader,
  decodeByte,
  firstWord,
  plainText,
  skipFallback,
} from './rtf-text.ts';
import {
  PICTURE_CHARACTER,
  type Picture,
  same,
  type Font,
  type Formatting,
  type ParagraphFormat,
  type RichDocument,
  type RichParagraph,
  type Run,
  type TabStop,
} from './rich-text.ts';

/** Words that set document settings, wherever they are. */
const DOCUMENT_WORDS = new Set([
  'rtf',
  'ansi',
  'mac',
  'pc',
  'pca',
  'ansicpg',
  'cocoartf',
  'cocoasubrtf',
  'cocoatextscaling',
  'cocoaplatform',
  'deff',
  'deftab',
  'paperw',
  'paperh',
  'margl',
  'margr',
  'margt',
  'margb',
  'vieww',
  'viewh',
  'viewkind',
  'viewscale',
  'readonlydoc',
]);

const PARAGRAPH_RESET = 'pard';

const SKIPPED = new Set(['info', 'stylesheet', 'pict', 'header', 'footer', 'footnote']);

/** The extension of each kind of picture RTF names. */
const PICTURE_KINDS: Record<string, string> = { jpegblip: 'jpg', pngblip: 'png' };

/** What a picture's file is called, as far as its RTF says. */
function pictureFile(tokens: RtfToken[]): Partial<Picture> {
  const file: Partial<Picture> = {};
  for (const token of tokens) {
    if (token.kind === 'control' && PICTURE_KINDS[token.word]) {
      file.extension = PICTURE_KINDS[token.word]!;
    } else if (token.kind === 'group' && firstWord(token) === 'nisusfilename') {
      file.name = writeRtfSyntax(token.tokens.slice(1)).trim();
    } else if (token.kind === 'group') Object.assign(file, pictureFile(token.tokens));
  }
  return file;
}

/** The hex digits a picture's RTF holds, after the word that says what it is. */
function pictureHex(tokens: RtfToken[]): string {
  let hex = '';
  let started = false;
  for (const token of tokens) {
    if (token.kind === 'group') hex += pictureHex(token.tokens);
    else if (token.kind === 'control' && PICTURE_KINDS[token.word]) started = true;
    else if (token.kind === 'text' && started) hex += token.text;
  }
  return hex;
}

/** A picture's file, from its RTF. */
export function pictureBytes({ rtf }: Picture): Uint8Array {
  return hexBytes(pictureHex(readRtfSyntax(rtf)).replaceAll(/\s/g, ''));
}

/** Reads an RTF document's rich text. */
export function readRichText(source: string): RichDocument {
  return new RichReader(readRtfSyntax(source)).read();
}

/** The groups that hold a document's tables, which come before its text. */
const TABLE_GROUPS = new Set([
  'fonttbl',
  'colortbl',
  'expandedcolortbl',
  'listtable',
  'listoverridetable',
]);

/**
 * A place between two of the document group's own tokens where whole paragraphs end: what
 * comes after it reads the same wherever it is written, given the formatting there.
 */
export interface Cut extends Formatting {
  /** How many of the document group's tokens come before it. */
  tokens: number;
  /** How many paragraphs end before it. */
  paragraphs: number;
  paragraph: ParagraphFormat;
}

/** A document read with the places its RTF can be cut. */
export interface CutDocument {
  document: RichDocument;
  /** The document group's tokens, and what follows the group. */
  tokens: RtfToken[];
  after: RtfToken[];
  /** How many tokens the header is: the settings and tables before the text. */
  header: number;
  cuts: Cut[];
}

/** Reads a document and where its RTF can be cut; nothing when it has no document group. */
export function readCutDocument(source: string): CutDocument | undefined {
  const tokens = readRtfSyntax(source);
  const [group] = tokens;
  if (tokens.length === 0 || group?.kind !== 'group') return undefined;
  return new RichReader(tokens).readCuts();
}

/** Whether the token belongs in a document's header: a setting, a table, or a new line. */
function inHeader(token: RtfToken): boolean {
  if (token.kind === 'text') return /^[\r\n]*$/.test(token.text);
  if (token.kind === 'control') return DOCUMENT_WORDS.has(token.word) || token.word === 'uc';
  if (token.kind !== 'group') return false;
  const [first] = token.tokens;
  return first?.kind === 'control' && TABLE_GROUPS.has(first.word);
}

interface State extends Formatting {
  paragraph: ParagraphFormat;
  /** Inside a group whose text is not the document's. */
  skip: boolean;
  marker: boolean;
}

class RichReader {
  private readonly tokens: RtfToken[];
  private readonly document: RichDocument = {
    settings: {},
    fonts: [],
    colors: [],
    lists: [],
    listOverrides: [],
    paragraphs: [],
  };
  private readonly fontNumbers = new Map<number, Font>();
  private state: State = {
    character: {},
    paragraph: {},
    unicodeSkip: 1,
    skip: false,
    marker: false,
  };
  private runs: Run[] = [];
  private marker: Run[] | undefined;
  private readonly rows = new RowReader();
  /** Characters still to skip after a `\u`. */
  private skipping = 0;
  /** The kind of the tab stop whose position comes next. */
  private tabKind: string | undefined;
  private readonly readByte = codePageReader();

  private readonly after: RtfToken[];

  constructor(tokens: RtfToken[]) {
    const [document, ...after] = tokens;
    this.tokens = document?.kind === 'group' ? document.tokens : tokens;
    this.after = document?.kind === 'group' ? after : [];
  }

  read(): RichDocument {
    this.walk(this.tokens);
    return this.finish();
  }

  /** Reads the document, noting each place between its own tokens where paragraphs end whole. */
  readCuts(): CutDocument {
    const cuts: Cut[] = [];
    const header = this.tokens.findIndex((token) => !inHeader(token));
    const cut = (tokens: number) => {
      if (!this.whole()) return;
      const { character, paragraph, unicodeSkip } = this.state;
      cuts.push({
        tokens,
        paragraphs: this.document.paragraphs.length,
        character: cleanCharacter(character),
        paragraph: cleanParagraph(paragraph),
        unicodeSkip,
      });
    };
    this.tokens.forEach((token, index) => {
      if (index === 0) cut(0);
      this.walk([token]);
      cut(index + 1);
    });
    const { tokens, after } = this;
    const document = this.finish();
    return { document, tokens, after, header: header === -1 ? tokens.length : header, cuts };
  }

  /** Whether every paragraph begun so far has ended, a table row with it. */
  private whole(): boolean {
    const end = this.document.paragraphs.at(-1)?.end.kind;
    return (
      this.runs.length === 0 &&
      this.marker === undefined &&
      this.tabKind === undefined &&
      !this.rows.pending() &&
      end !== 'cell' &&
      end !== 'nestcell'
    );
  }

  private finish(): RichDocument {
    // Whatever follows the document's group, which a well-formed document never has.
    this.walk(this.after);
    if (this.runs.length > 0 || this.marker) this.endParagraph('document');
    return this.document;
  }

  private walk(tokens: RtfToken[]): void {
    for (const token of tokens) {
      if (token.kind === 'group') this.group(token);
      else if (token.kind === 'control') this.control(token);
      else if (token.kind === 'symbol') this.symbol(token.symbol);
      // A byte the `\\uc` before it says stands in for a `\\u` counts as a character of its own.
      else if (token.kind === 'hex') {
        const { charset } = this.state.character.font ?? {};
        this.text(this.skipping > 0 ? decodeByte(token.byte) : this.readByte(token.byte, charset));
      }
      // New lines are not text in RTF; nor is a brace, which only a stray `}` leaves in text.
      else this.text(token.text.replaceAll(/[\r\n}]/g, ''));
    }
  }

  private group(group: RtfGroup): void {
    const word = firstWord(group);
    if (word === 'fonttbl') {
      const { fonts, numbers } = readFonts(group);
      this.document.fonts.push(...fonts);
      for (const [number, font] of numbers) this.fontNumbers.set(number, font);
      return;
    }
    if (word === 'colortbl') {
      this.document.colors.push(...readColors(group));
      return;
    }
    if (word === 'expandedcolortbl') {
      readExpandedColors(group).forEach((expanded, index) => {
        const color = this.document.colors[index];
        if (color && expanded) color.expanded = expanded;
      });
      return;
    }
    if (word === 'listtable') {
      this.document.lists.push(...readLists(group));
      return;
    }
    if (word === 'listoverridetable') {
      this.document.listOverrides.push(...readListOverrides(group));
      return;
    }
    if (word === 'field') return this.readField(group);
    if (word === 'shppict' || word === 'pict') return this.readPicture(group);
    const saved = this.state;
    this.state = { ...saved, character: { ...saved.character }, paragraph: { ...saved.paragraph } };
    let tokens = group.tokens;
    if (word === 'listtext') {
      this.state.marker = true;
      this.marker = [];
      tokens = tokens.slice(1);
    } else if (group.ignorable || (word !== undefined && SKIPPED.has(word))) {
      this.state.skip = true;
    }
    this.walk(tokens);
    // A group's formatting ends with it; the paragraph's does not when the group held its end.
    this.state = saved;
  }

  /** An embedded picture, whose RTF is kept as it is written. */
  private readPicture(group: RtfGroup): void {
    if (this.state.skip) return;
    const saved = this.state;
    const picture = { rtf: writeRtfSyntax([group]), ...pictureFile(group.tokens) };
    this.state = { ...saved, character: { ...saved.character, picture } };
    this.text(PICTURE_CHARACTER);
    this.state = saved;
  }

  private control({ word, parameter }: RtfControl): void {
    if (this.state.skip) return;
    if (DOCUMENT_WORDS.has(word)) {
      this.document.settings[word] = parameter ?? true;
      return;
    }
    if (word === 'uc') {
      this.state.unicodeSkip = parameter ?? 1;
      return;
    }
    if (word === 'u') {
      if (parameter === undefined) return;
      this.text(String.fromCharCode(parameter < 0 ? parameter + 65_536 : parameter));
      this.skipping = this.state.unicodeSkip;
      return;
    }
    if (word === 'par') return this.endParagraph('paragraph');
    if (word === 'cell' || word === 'nestcell') return this.endParagraph(word);
    if (word === 'row' || word === 'nestrow') return this.endRow(word);
    if (word === 'line') return this.text(' ');
    if (word === 'tab') return this.text('\t');
    const symbol = SYMBOL_WORDS[word];
    if (symbol !== undefined) return this.text(symbol);
    if (ROW_WORDS.test(word)) {
      const depth = this.state.paragraph.table?.depth ?? 1;
      return this.rows.word(word, parameter, depth, this.document.colors);
    }
    // `\pard` and `\plain` start the paragraph's or the characters' formatting over; a field's
    // instruction is not formatting, and stays.
    if (word === PARAGRAPH_RESET) {
      this.state.paragraph = {};
      return;
    }
    if (word === 'plain') {
      const { field } = this.state.character;
      this.state.character = field === undefined ? {} : { field };
      return;
    }
    // A tab stop's kind comes just before its position.
    if (word === 'tqr' || word === 'tqc' || word === 'tqdec') {
      this.tabKind = word;
      return;
    }
    if (word === 'tx') {
      const stop: TabStop = { position: parameter ?? 0 };
      if (this.tabKind) stop.kind = this.tabKind;
      this.tabKind = undefined;
      this.state.paragraph.tabs = [...(this.state.paragraph.tabs ?? []), stop];
      return;
    }
    if (paragraphWord(this.state.paragraph, word, parameter)) return;
    characterWord(this.state.character, word, parameter, this.fontNumbers, this.document.colors);
  }

  private symbol(symbol: string): void {
    if (symbol === '\n' || symbol === '\r') return this.endParagraph('paragraph');
    const text = CONTROL_SYMBOLS[symbol];
    if (text !== undefined) this.text(text);
  }

  private text(text: string): void {
    if (this.state.skip || text === '') return;
    const { kept, skipping } = skipFallback(text, this.skipping);
    this.skipping = skipping;
    if (kept === '') return;
    const runs = this.state.marker ? this.marker! : this.runs;
    const format = cleanCharacter(this.state.character);
    const last = runs.at(-1);
    if (last && same(last.format, format)) last.text += kept;
    else runs.push({ text: kept, format });
  }

  private endParagraph(kind: RichParagraph['end']['kind']): void {
    if (this.state.skip) return;
    const paragraph: RichParagraph = {
      format: cleanParagraph(this.state.paragraph),
      content: this.runs,
      end: { kind, format: cleanCharacter(this.state.character) },
    };
    if (this.marker) paragraph.marker = this.marker;
    const row = this.rows.take();
    if (row) paragraph.row = row;
    this.document.paragraphs.push(paragraph);
    this.runs = [];
    this.marker = undefined;
  }

  private endRow(word: 'row' | 'nestrow'): void {
    const last = this.document.paragraphs.at(-1);
    const lastRow = this.rows.takeLastRow();
    if (last?.end.kind === 'cell' || last?.end.kind === 'nestcell') {
      last.end.kind = word;
      if (lastRow) last.end.lastRow = true;
    }
  }

  private readField(field: RtfGroup): void {
    let instruction = '';
    for (const token of field.tokens) {
      if (token.kind !== 'group') continue;
      const [first] = token.tokens;
      const word = first?.kind === 'control' ? first.word : undefined;
      if (word === 'fldinst') instruction = plainText(token.tokens.slice(1)).trim();
      else if (word === 'fldrslt') {
        const saved = this.state;
        this.state = { ...saved, character: { ...saved.character, field: instruction } };
        this.walk(token.tokens.slice(1));
        this.state = saved;
      }
    }
  }
}
