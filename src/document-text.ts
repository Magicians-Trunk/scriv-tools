import { BoundText } from './bound-text.ts';
import type { CompileFormat } from './compile-format.ts';
import type { Documents, DocumentText } from './document.ts';
import type { MarkupNode } from './markup.ts';
import { struckChangesMarkup, struckOut } from './struck-text.ts';
import { type BinderIndex, findItem } from './project.ts';
import {
  type Includes,
  type MarkupInput,
  type MarkupOptions,
  type ResolvedCell,
  type ResolvedNode,
  type ResolvedParagraph,
  inlineIncludes,
  resolveMarkup,
} from './resolve-markup.ts';
import { groupParagraphs, type RtfListItem } from './grouping.ts';
import { type OutputNode, isBlank, markup, serialize, uppercaseWords, without } from './output.ts';
import { buildParagraph, NO_STYLE, type OpenStyles } from './paragraph.ts';
import type { Alignment } from './rich-text.ts';
import { UnsupportedError } from './unsupported.ts';

/** The project's compile options that change a document's text. */
export interface TextOptions extends MarkupOptions {
  convertLists: boolean;
}

/** What rendering a document reads from the compile. */
export interface TextInput extends MarkupInput {
  format: CompileFormat;
  settings: { text: TextOptions };
  documents: Pick<Documents, 'text'>;
  index: Pick<BinderIndex, 'byId' | 'byTitle'>;
}

/** What a section layout sets for the text it holds. */
export interface TextLayout {
  /** Replaces each empty, unstyled line. */
  blankLineSeparator?: string;
  /** The paragraph style the layout gives the whole text, by name. */
  textStyle?: string;
  /** How many of the text's first words it sets in capitals. */
  uppercasedWords?: number;
}

/**
 * Compiled text: nothing when there was nothing to compile; its footnotes, in order; and the
 * Scrivener markup it writes out as it is, as Scrivener does.
 */
export interface Rendered {
  text: BoundText | undefined;
  notes: BoundText[];
  leftAsWritten: string[];
}

/** A line of the compiled text: a paragraph, or a table with any caption. */
interface Line {
  nodes: OutputNode[];
  list: boolean;
  /** The paragraph style the line starts in. */
  style?: string;
  /** Set for a table; `nodes` then follow the table and its caption. */
  table?: TableLine;
  /** Which of the document's paragraphs it is, when it is one and only one. */
  source?: number;
  /** The empty lines its paragraph spacing comes to, when the format converts that. */
  emptyBefore?: number;
  emptyAfter?: number;
}

interface TableLine {
  rows: { cell: ResolvedCell; paragraphs: OutputNode[][] }[][];
  caption?: { nodes: OutputNode[]; above: boolean };
  /** Whether the table is set apart from the line before and the line after. */
  blankBefore: boolean;
  blankAfter: boolean;
}

const ALIGNMENT_ROW: Record<Alignment, string | undefined> = {
  left: ':-----',
  center: ':-----:',
  right: '-----:',
  justified: undefined,
};

/** The list table's bullet format (`\levelnfc23`); every other format numbers. */
const BULLET_FORMAT = 23;
/** The format for a level with no marker (`\levelnfc255`). */
const NO_MARKER_FORMAT = 255;

/** The twips in a line of text, by which paragraph spacing comes to empty lines. */
const LINE_TWIPS = 240;

/** The empty lines paragraph spacing comes to: 28 points at 12 is two, as Scrivener's manual has it. */
const emptyLines = (twips = 0) => Math.round(twips / LINE_TWIPS);

/**
 * A document's text as the compile emits it, before placeholders and transformations; nothing
 * when it has no paragraphs.  A paragraph whose text a character style deletes is still there.
 * Its footnotes are numbered from after the compile's `notesBefore`.  Given the binder ID of the
 * `item` it is the text of, each paragraph's compiled form says so.
 */
export function renderText(
  document: DocumentText,
  input: TextInput,
  layout: TextLayout = {},
  notesBefore = 0,
  item?: string,
): Rendered {
  const { format } = input;
  const options = input.settings.text;
  const leftAsWritten: string[] = [];
  const styleOf = (name: string) => ({ name, style: format.styles.get(name) ?? NO_STYLE });
  const lines: Line[] = [];
  // The layout's style for the whole text, which the document's own paragraph styles end.
  const textStyle =
    layout.textStyle === undefined
      ? undefined
      : { name: layout.textStyle, style: format.styles.get(layout.textStyle) ?? NO_STYLE };
  if (textStyle && (textStyle.style.prefix || textStyle.style.suffix)) {
    throw new UnsupportedError(`a section layout styling text in "${textStyle.name}"`);
  }
  // Each list level's kind (numbered or not) and count, outermost first.
  let listLevels: { numbered: boolean; count: number }[] = [];
  const { richText } = options;
  const environment = { format, styleOf, textStyle, ...(richText ? { richText } : {}) };
  // The styles open from one paragraph to the next.
  let open: OpenStyles = { paragraph: textStyle, character: undefined };
  const render = (nodes: ResolvedNode[]) => {
    const built = buildParagraph(nodes, open, environment);
    open = built.open;
    for (const suffix of built.suffixesBefore) appendToPrevious(lines, suffix);
    leftAsWritten.push(...built.leftAsWritten);
    return built;
  };

  const paragraphs = resolveDocument(document, input, []);

  const isCaption = (line: Line | undefined) =>
    line?.style !== undefined && !line.list && line.style === format.captionStyle;
  let tableBelow: TableLine | undefined;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]!;
    if (paragraph.row) {
      const rows: ResolvedCell[][] = [];
      for (let next = paragraphs[index]; next?.row; next = paragraphs[index]) {
        rows.push(next.row);
        index += 1;
      }
      index -= 1;
      const captionAbove = isCaption(lines.at(-1)) ? lines.pop() : undefined;
      const renderCell = (nodes: ResolvedNode[]) => {
        // A style that ends where the table starts closes in its first cell; that is fine
        // unless the style has a suffix, which would land somewhere unconfirmed.
        const styled = nodes.some(
          (node) =>
            node.kind === 'style' &&
            node.scope === 'paragraph' &&
            (!node.closing || styleOf(node.name).style.suffix !== ''),
        );
        if (styled) throw new UnsupportedError('paragraph styles in table cells');
        return render(nodes).nodes;
      };
      const table: TableLine = {
        rows: rows.map((row) =>
          row.map((cell) => ({ cell, paragraphs: cell.paragraphs.map(renderCell) })),
        ),
        blankBefore: !captionAbove,
        blankAfter: true,
      };
      if (captionAbove) table.caption = { nodes: captionAbove.nodes, above: true };
      lines.push({ nodes: [], list: false, table });
      tableBelow = captionAbove ? undefined : table;
      continue;
    }
    const run = render(paragraph.nodes);
    if (run.deleted && isBlank(run.nodes)) continue;
    const line: Line = { nodes: run.nodes, list: paragraph.list !== undefined };
    if (run.style) line.style = run.style;
    if (paragraph.source !== undefined) line.source = paragraph.source;
    if (format.paragraphSpacing) {
      line.emptyBefore = emptyLines(paragraph.spacing?.spaceBefore);
      line.emptyAfter = emptyLines(paragraph.spacing?.spaceAfter);
    }
    if (paragraph.list) {
      if (!options.convertLists) throw new UnsupportedError('lists without list conversion');
      const { level, marker } = paragraph.list;
      const numbered = isNumbered(paragraph.list);
      // Each level counts through the whole run of a list, across shallower items between.
      if (!lines.at(-1)?.list) listLevels = [];
      const current = listLevels[level];
      const count = current?.numbered === numbered ? current.count + 1 : 1;
      listLevels[level] = { numbered, count };
      const indent = '    '.repeat(level);
      // A heading style starting on a list item: Scrivener writes the item's own marker as text
      // and drops the heading's prefix.
      const bullet = `${indent}${numbered ? `${count}. ` : '* '}`;
      line.nodes = run.openedPrefix
        ? [markup(`${bullet}${marker}\t`), ...without(run.nodes, run.openedPrefix)]
        : [markup(bullet), ...run.nodes];
    } else if (isBlank(line.nodes) && !run.style && layout.blankLineSeparator) {
      line.nodes = [markup(layout.blankLineSeparator)];
    }
    if (tableBelow && isCaption(line)) {
      tableBelow.caption = { nodes: line.nodes, above: false };
      tableBelow.blankAfter = false;
    } else {
      lines.push(line);
    }
    tableBelow = undefined;
  }
  if (open.paragraph) appendToPrevious(lines, open.paragraph.style.suffix);
  let wordsLeft = layout.uppercasedWords ?? 0;
  for (const line of lines) wordsLeft = uppercaseWords(line.nodes, wordsLeft);
  // Written out in order, so footnotes are numbered as they appear.
  const notes: BoundText[] = [];
  const write = (nodes: OutputNode[]) => {
    const written = serialize(nodes, notesBefore + notes.length);
    notes.push(...written.notes);
    return written.text;
  };
  const sourced = (content: BoundText, source: number | undefined) =>
    item !== undefined && source !== undefined ? BoundText.source(content, item, source) : content;
  const written = lines.map((line) => {
    if (!line.table) {
      const nodes = write(line.nodes);
      const content = line.list ? BoundText.listLine(nodes) : nodes;
      return { line, content: sourced(content, line.source) };
    }
    // A caption goes under the table, wherever it was; one above is written first, as it was.
    const { caption } = line.table;
    const above = caption?.above ? write(caption.nodes) : undefined;
    const table = renderTable(line.table.rows, write, sourced);
    const captionText = above ?? (caption && write(caption.nodes));
    const parts = [table, ...(captionText ? ['\n[', captionText, ']'] : []), write(line.nodes)];
    return { line, content: BoundText.join(parts) };
  });
  const text = lines.length === 0 ? undefined : BoundText.join(separateBlocks(written), '\n');
  return { text, notes, leftAsWritten };
}

/**
 * A document's paragraphs, resolved for the compile, with each included document's paragraphs
 * in place of the link that includes it.
 */
export function resolveDocument(
  document: DocumentText,
  input: TextInput,
  including: string[],
): ResolvedParagraph[] {
  const options = input.settings.text;
  const includes: Includes = {
    byId: (id) => {
      if (including.includes(id)) throw new UnsupportedError('a document that includes itself');
      const included = input.documents.text(findItem(input.index, id).id);
      return resolveDocument(included, input, [...including, id]);
    },
    // A document named by its title, the first in the binder that has it.
    byTitle: (title) => {
      const named = input.index.byTitle.get(title);
      return named && includes.byId(named.id);
    },
  };
  const resolve = (nodes: MarkupNode[], listItem = false) =>
    resolveMarkup(
      options.deleteStruckThrough ? struckOut(nodes) : nodes,
      document,
      input,
      includes,
      listItem,
    );
  const resolveCell = (nodes: MarkupNode[]) => inlineIncludes(resolve(nodes), 'a table cell');
  // Scrivener deletes struck-through text before it reads its markup.
  if (
    options.deleteStruckThrough &&
    document.paragraphs.some((paragraph) => struckChangesMarkup(paragraph.content))
  ) {
    throw new UnsupportedError('struck-through text that cuts across Scrivener markup');
  }
  const grouped = groupParagraphs(document, []);
  return grouped.flatMap((paragraph): ResolvedParagraph[] => {
    if (paragraph.row) {
      const row = paragraph.row.map(({ paragraphs: cellParagraphs, ...cell }) => ({
        ...cell,
        indices: including.length === 0 ? cell.indices : [],
        paragraphs: cellParagraphs.map(resolveCell),
      }));
      return [{ nodes: [], row }];
    }
    const resolved: ResolvedParagraph = { nodes: resolve(paragraph.content, !!paragraph.list) };
    if (paragraph.index !== undefined)
      resolved.spacing = document.paragraphs[paragraph.index]!.format;
    if (paragraph.list) resolved.list = paragraph.list;
    // What another document includes, and text joined to it, is not one paragraph of this one.
    const whole = including.length === 0 && !resolved.nodes.some(({ kind }) => kind === 'include');
    if (whole && paragraph.index !== undefined) resolved.source = paragraph.index;
    return spliceIncludes(resolved);
  });
}

/** An included paragraph's nodes, which keep their own styles (see `included`). */
const own = (nodes: ResolvedNode[]): ResolvedNode[] => [{ kind: 'included', content: nodes }];

/**
 * Puts an included document's paragraphs where its link is: the text before the link joins the
 * first of them, and the text after joins the last.
 */
function spliceIncludes(paragraph: ResolvedParagraph): ResolvedParagraph[] {
  const spliced: ResolvedParagraph[] = [];
  let current: ResolvedParagraph = { ...paragraph, nodes: [] };
  for (const node of paragraph.nodes) {
    if (node.kind !== 'include') {
      current.nodes.push(node);
      continue;
    }
    const [first, ...rest] = node.paragraphs;
    const last = rest.at(-1);
    if (first?.row || last?.row) {
      throw new UnsupportedError('an included document that starts or ends with a table');
    }
    current.nodes.push(...own(first?.nodes ?? []));
    if (last) {
      const middle = rest.slice(0, -1).map((each) => ({ ...each, nodes: own(each.nodes) }));
      spliced.push(current, ...middle);
      current = { ...last, nodes: own(last.nodes) };
    }
  }
  spliced.push(current);
  return spliced;
}

/** Whether a list item numbers, from its list level's format in the RTF's list table. */
function isNumbered({ format, counted }: RtfListItem): boolean {
  if (format === undefined) throw new UnsupportedError('a list item with no list definition');
  if (format === NO_MARKER_FORMAT) throw new UnsupportedError('a list level with no marker');
  return counted === true || format !== BULLET_FORMAT;
}

/**
 * A table in MultiMarkdown.  The header runs to the first row with no merged cells, and that row
 * sets each column's alignment.  Scrivener also adds a space after a cell whose alignment differs
 * from the first row's cell above it, but only under the first row's first two cells (a merged
 * pair counts as one), and never to an empty cell.  A cell's paragraphs each end with a space,
 * and a row continuing cells merged down from the row above is written onto that row's line.
 */
function renderTable(
  table: TableLine['rows'],
  write: (nodes: OutputNode[]) => BoundText,
  sourced: (content: BoundText, source: number | undefined) => BoundText,
): BoundText {
  const rows = table.map((row) => row.map(({ cell }) => cell));
  if (rows.flat().some((cell) => cell.nested)) throw new UnsupportedError('nested tables');
  const [first = []] = rows;
  const headerEnd = rows.findIndex((row) => row.every((cell) => cell.merge === 'none'));
  if (headerEnd === -1) throw new UnsupportedError('a table whose every row has merged cells');
  const alignments = rows[headerEnd]!.map((cell) => {
    const row = ALIGNMENT_ROW[cell.alignment];
    if (row === undefined) throw new UnsupportedError('a justified cell in the alignment row');
    return row;
  });
  // The first row's cell each column falls under, counting a merged pair as one cell.
  let owner = -1;
  const firstRowCell = first.map((cell) => (cell.merge === 'rest' ? owner : (owner += 1)));
  const cellText = (column: number, index: number) => {
    const { cell, paragraphs: rendered } = table[index]![column]!;
    if (cell.merge === 'rest') return BoundText.of('|');
    const paragraphs = rendered.map((nodes, at) => sourced(write(nodes), cell.indices[at]));
    const content =
      paragraphs.length > 1
        ? BoundText.join(paragraphs.flatMap((part) => [part, ' ']))
        : paragraphs[0]!;
    const padded =
      index > 0 &&
      content.text !== '' &&
      (firstRowCell[column] ?? 2) < 2 &&
      cell.alignment !== first[column]?.alignment;
    return BoundText.join([' ', BoundText.trimmed(content, 'start'), padded ? '  |' : ' |']);
  };
  const lines: BoundText[][] = [];
  rows.forEach((row, index) => {
    const cells = row.flatMap((cell, column) =>
      cell.merge === 'below' ? [] : [cellText(column, index)],
    );
    // A row continuing cells merged down from the row above is written onto that row's line.
    const above = lines.at(-1);
    if (!row.some((cell) => cell.merge === 'below')) lines.push([BoundText.of('|'), ...cells]);
    else if (above) above.push(...cells);
    else throw new UnsupportedError('a table whose first row continues a merge from above');
    if (index === headerEnd) {
      lines.push([BoundText.of(`|${alignments.map((alignment) => ` ${alignment} |`).join('')}`)]);
    }
  });
  return BoundText.join(
    lines.map((line) => BoundText.join(line)),
    '\n',
  );
}

/**
 * A paragraph style's suffix ends the range's last paragraph.  When that paragraph is empty,
 * Scrivener emits no suffix (observed in a real compile; not in the manual).
 */
function appendToPrevious(lines: Line[], suffix: string): void {
  const previous = lines.at(-1);
  if (previous && (previous.table || !isBlank(previous.nodes))) previous.nodes.push(markup(suffix));
}

/**
 * Lists and tables are set apart from neighbouring text by an empty line, as MultiMarkdown
 * needs.  A table's caption takes the place of the empty line on its side.
 */
function separateBlocks(written: { line: Line; content: BoundText }[]): BoundText[] {
  const after = (line: Line, next: Line) => (line.list ? !next.list : line.table?.blankAfter);
  const before = (line: Line, previous: Line) =>
    line.list ? !previous.list : line.table?.blankBefore;
  return written.flatMap(({ line, content }, index) => {
    const previous = written[index - 1];
    if (previous === undefined || previous.content.text === '' || content.text === '') {
      return [content];
    }
    const spaced = (previous.line.emptyAfter ?? 0) + (line.emptyBefore ?? 0);
    const apart = after(previous.line, line) || before(line, previous.line);
    const empty = Math.max(spaced, apart ? 1 : 0);
    return [...Array.from({ length: empty }, () => BoundText.of('')), content];
  });
}
