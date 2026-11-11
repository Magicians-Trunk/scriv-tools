/** The formatting in effect at a place in a document's RTF, between its paragraphs. */
export interface Formatting {
  character: CharacterFormat;
  /** Missing before the first `\pard`. */
  paragraph?: ParagraphFormat;
  /** How many characters a reader skips after a `\u` (`\uc`). */
  unicodeSkip: number;
}

/**
 * A document's rich text, as macOS holds it: paragraphs of runs, each run with its character
 * formatting and each paragraph with its own, and the document's settings.  Fonts and colours
 * are values here; the RTF's tables of them are the writer's business.
 */
export interface RichDocument<Content = Run[]> {
  settings: DocumentSettings;
  /** The document's fonts and colours in the order its RTF lists them, used or not. */
  fonts: Font[];
  /** `null` for the automatic colour, the table's empty first entry. */
  colors: (Color | null)[];
  /** The lists the document's list items belong to, and the overrides (`\ls`) that name them. */
  lists: ListDefinition[];
  listOverrides: ListOverride[];
  paragraphs: RichParagraph<Content>[];
}

/** Document-wide settings (`\deftab720`, `\paperw12240`…), by control word. */
export type DocumentSettings = Record<string, number | true>;

export interface Font {
  name: string;
  /** `nil`, `swiss`, `roman`, `modern`, `script`, `decor` or `tech`. */
  family: string;
  charset?: number;
  /** Other words of the font's entry (`\fprq2`), by word. */
  other?: Record<string, number | true>;
}

/** A colour by its 8-bit components, and its exact colour space and values, when given. */
export interface Color {
  red: number;
  green: number;
  blue: number;
  /** `\csgenericrgb\c33333\c66667\c100000`: the space, and each `\c` value. */
  expanded?: { space: string; values: number[] };
}

/** A run's formatting; what it leaves out is the default. */
/** An embedded picture: its RTF as written, and what the file is called when it is exported. */
export interface Picture {
  rtf: string;
  name?: string;
  extension?: string;
}

/** The character that stands for an embedded picture in a run's text. */
export const PICTURE_CHARACTER = '\uFFFC';

export interface CharacterFormat {
  font?: Font;
  /** In points. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: { style: string; color?: Color | null };
  strike?: { style: string; color?: Color | null };
  /** `null` for the automatic colour, `\cf0`. */
  color?: Color | null;
  background?: Color | null;
  highlight?: Color | null;
  /** Character spacing, as `\expnd` (quarter points) and `\expndtw` (twips). */
  expand?: { quarterPoints: number; twips: number };
  kerning?: number;
  /** Baseline offset in half points: up when positive. */
  baseline?: number;
  script?: 'super' | 'sub' | 'none';
  outline?: boolean;
  stroke?: { width?: number; color?: Color | null };
  shadow?: boolean;
  /** A hyperlink field's instruction (`HYPERLINK "scrivlnk://…"`), or another field's. */
  field?: string;
  /** Set on the run that is an embedded picture. */
  picture?: Picture;
  /** Other character words, by word, as last set. */
  other?: Record<string, number | true>;
}

/** A paragraph's formatting; what it leaves out is the default. */
/** How a paragraph's lines line up. */
export type Alignment = 'left' | 'center' | 'right' | 'justified';

export interface ParagraphFormat {
  alignment?: Alignment;
  tabs?: TabStop[];
  /** In twips. */
  defaultTab?: number;
  leftIndent?: number;
  firstIndent?: number;
  rightIndent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  /** `\sl`: line spacing in twips, and `\slmult`: whether it is a multiple of single. */
  lineSpacing?: { twips: number; multiple: number };
  naturalDirection?: boolean;
  tightenFactor?: number;
  /** The list override (`\ls`) and level (`\ilvl`) of a list item. */
  list?: { override: number; level: number };
  /** Inside a table, at this nesting depth (`\itap`); `\intbl` without `\itap` is depth 1. */
  table?: { depth: number; inTable: boolean };
}

/** A list: its levels, from the outermost. */
export interface ListDefinition {
  id: number;
  templateId?: number;
  hybrid: boolean;
  name: string;
  levels: ListLevel[];
  /** Other words of the list, by word. */
  other?: Record<string, number | true>;
}

/** One level of a list. */
export interface ListLevel {
  /** How it numbers (`\levelnfc`): 0 decimal, 23 bullet, 255 none, and so on. */
  numberFormat: number;
  numberFormatN?: number;
  justification?: number;
  justificationN?: number;
  follow?: number;
  startAt?: number;
  space?: number;
  indent?: number;
  /** macOS's marker format, such as `{decimal}.` or `{disc}`. */
  marker?: string;
  /** The marker's text: text, and the numbers of levels (from 0) where they go. */
  text: { templateId?: number; parts: (string | { level: number })[] };
  firstIndent?: number;
  leftIndent?: number;
  /** `\lin`: the left indent, for left-to-right text. */
  lineIndent?: number;
  /** Other words of the level (its marker's font and the like), by word. */
  other?: Record<string, number | true>;
}

/** A list override, which list items name with `\ls`. */
export interface ListOverride {
  listId: number;
  count: number;
  override: number;
}

/** A table row's layout, which macOS writes before the row's first paragraph. */
export interface TableRow {
  /** The table's nesting depth, `\itap`. */
  depth: number;
  flags?: number;
  gap?: number;
  left?: number;
  autofit?: boolean;
  lastRow?: boolean;
  borders: Borders;
  cells: TableCell[];
  /** Other row words, by word. */
  other?: Record<string, number | true>;
}

export interface Borders {
  top?: Border;
  left?: Border;
  bottom?: Border;
  right?: Border;
}

/** A border: its style word (`brdrnil`, `brdrs`…), width and colour. */
export interface Border {
  style?: string;
  width?: number;
  color?: Color | null;
}

/** A cell's layout in its row. */
export interface TableCell {
  /** Where the cell's right edge is, in twips (`\cellx`). */
  right: number;
  verticalAlign?: 'top' | 'center' | 'bottom';
  background?: Color | null;
  /** `\clshdrawnil`: no shading. */
  noShading?: boolean;
  borders: Borders;
  padding: { left?: number; right?: number; top?: number; bottom?: number };
  merge?: 'first' | 'rest' | 'top' | 'below';
  /** A preferred width: its value (`\clwWidth`) and units (`\clftsWidth`). */
  width?: { value?: number; units?: number };
  /** `\gaph`. */
  gap?: boolean;
  other?: Record<string, number | true>;
}

export interface TabStop {
  position: number;
  /** `tqr`, `tqc` or `tqdec`; left when missing. */
  kind?: string;
}

/** How a line break inside a paragraph reads as text: Unicode's line separator. */
export const LINE_BREAK = '\u2028';

export interface Run {
  text: string;
  format: CharacterFormat;
}

export interface RichParagraph<Content = Run[]> {
  format: ParagraphFormat;
  /** Its text: runs of formatted text, or the markup read from them. */
  content: Content;
  /** A list item's marker as the RTF writes it (`{\listtext\t1.\t}`), its runs. */
  marker?: Run[];
  /** How the paragraph ends: a paragraph mark, the end of a table cell, of a row too, or of the
   * document with no mark.  The mark has a format of its own. */
  end: {
    kind: 'paragraph' | 'cell' | 'row' | 'nestcell' | 'nestrow' | 'document';
    format: CharacterFormat;
    /** `\lastrow`: the row this ends is its table's last. */
    lastRow?: true;
  };
  /** The layout of the table row this paragraph starts, written before it. */
  row?: TableRow;
}

/** A value as JSON with its objects' keys in order, so equal values read the same. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

/** How many of an object's keys hold something: one holding nothing is as good as none, as in JSON. */
const heldKeys = (value: object) =>
  Object.keys(value).filter((key) => Reflect.get(value, key) !== undefined).length;

/**
 * Whether two values are equal, key order aside, as their `canonical` text would be.  It walks
 * the values rather than writing them out, as a reader asks it of every run it reads.
 */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!(a instanceof Object) || !(b instanceof Object)) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((inner, at) => same(inner, b[at]))
    );
  }
  for (const key of Object.keys(a)) {
    const inner: unknown = Reflect.get(a, key);
    if (inner !== undefined && !same(inner, Reflect.get(b, key))) return false;
  }
  return heldKeys(a) === heldKeys(b);
}
