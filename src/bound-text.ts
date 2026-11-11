/** Where a mark is in the text. */
interface Range {
  start: number;
  end: number;
}

/** A range of compiled text that describes another binder item, as a document link's text does. */
export interface Binding extends Range {
  kind: 'binding';
  /** The binder ID of the item the text describes. */
  item: string;
}

/**
 * Text Scrivener writes trimmed once it is final, which part of MultiMarkdown it is deciding
 * which side: a table cell at its start, a footnote at both ends, the metadata block at its end.
 */
export interface Trimmed extends Range {
  kind: 'trimmed';
  trim: 'start' | 'end' | 'both';
}

/** A list line, which MultiMarkdown needs set apart from text that follows. */
export interface ListLine extends Range {
  kind: 'list';
}

/** Text from the section layout, whose placeholders Scrivener evaluates after the replacements. */
export interface Deferred extends Range {
  kind: 'deferred';
}

/** A footnote's marker. */
export interface NoteMarker extends Range {
  kind: 'note';
}

/**
 * One end of a document link MultiMarkdown writes as `[text][reference]`: the opening `[`, or the
 * `][reference]` after the text.  The compile writes the reference once every heading is final.
 */
export interface LinkEdge extends Range {
  kind: 'link';
  /** The binder ID of the linked item. */
  link: string;
  edge: 'open' | 'close';
}

/** Part of a section's heading: the layout's title prefix, the title, or the title suffix. */
export interface HeadingPart extends Range {
  kind: 'heading';
  heading: string;
  part: 'prefix' | 'title' | 'suffix';
}

/** Text a document holds, as opposed to what the format adds around it. */
export interface Own extends Range {
  kind: 'own';
}

/** The compiled form of one paragraph of a document, its text and what the format adds. */
export interface Source extends Range {
  kind: 'source';
  /** The binder ID of the item whose text it is. */
  item: string;
  paragraph: number;
}

/**
 * Compiled text that is one binder item's: its section, a suffix it places after its
 * subdocuments, one of its footnotes, or its text in the metadata block.
 */
export interface Section extends Range {
  kind: 'section';
  /** The binder ID of the item. */
  item: string;
}

type Mark =
  | Binding
  | Trimmed
  | ListLine
  | Deferred
  | NoteMarker
  | LinkEdge
  | HeadingPart
  | Own
  | Source
  | Section;

/** The marks of one kind. */
type MarkOf<K extends Mark['kind']> = Extract<Mark, { kind: K }>;

const ofKind =
  <K extends Mark['kind']>(kind: K) =>
  (mark: Mark): mark is MarkOf<K> =>
    mark.kind === kind;

/** The text of each part of a heading. */
export type HeadingParts = Partial<Record<HeadingPart['part'], string>>;

/** A document link as written: to a reference in the same text, or to another file. */
export type WrittenLink = { text: string } & ({ ref: string } | { href: string });

/** What a document link becomes: a written link, or plain text when it has neither. */
export type LinkWriter = (item: string, text: string) => WrittenLink | undefined;

/** What closes a written link: its reference, unless its text says the same, or its file. */
function linkEnd(written: WrittenLink): string {
  if ('href' in written) return `](${written.href})`;
  return `][${written.ref === written.text ? '' : written.ref}]`;
}

/** Text that takes the place of the old text from `start` to `end`. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

const TRIMS: Record<Trimmed['trim'], (text: string) => string> = {
  start: (text) => text.trimStart(),
  end: (text) => text.trimEnd(),
  both: (text) => text.trim(),
};

/**
 * Compiled text with its marks: the ranges bound to other binder items, text written trimmed,
 * and list lines.
 * Scrivener runs replacements and placeholders over rich text, links and tables and all, and only
 * then writes MultiMarkdown tables, so the compile keeps these marks on the text until the end,
 * moving them with every edit as Scrivener's text attributes move.
 */
export class BoundText {
  readonly text: string;
  readonly marks: readonly Mark[];

  constructor(text = '', marks: readonly Mark[] = []) {
    this.text = text;
    this.marks = marks;
  }

  static of(text: string): BoundText {
    return new BoundText(text);
  }

  /** Text bound, all of it, to `item`. */
  static bound(text: string, item: string): BoundText {
    return new BoundText(
      text,
      text === '' ? [] : [{ kind: 'binding', start: 0, end: text.length, item }],
    );
  }

  /** Text to be written trimmed at `side` once it is final. */
  static trimmed(content: string | BoundText, side: Trimmed['trim']): BoundText {
    const bound = typeof content === 'string' ? BoundText.of(content) : content;
    const mark: Trimmed = { kind: 'trimmed', start: 0, end: bound.text.length, trim: side };
    return new BoundText(bound.text, [...bound.marks, mark]);
  }

  /** A list line. */
  static listLine(line: BoundText): BoundText {
    const mark: ListLine = { kind: 'list', start: 0, end: line.text.length };
    return new BoundText(line.text, [...line.marks, mark]);
  }

  /** Text a document holds. */
  static own(text: string): BoundText {
    return new BoundText(text, [{ kind: 'own', start: 0, end: text.length }]);
  }

  /** A paragraph's compiled form, which keeps its place even with no text. */
  static source(content: BoundText, item: string, paragraph: number): BoundText {
    const mark: Source = { kind: 'source', start: 0, end: content.text.length, item, paragraph };
    return new BoundText(content.text, [...content.marks, mark]);
  }

  /** Compiled text that is `item`'s, which keeps its place even with no text. */
  static section(content: BoundText, item: string): BoundText {
    const mark: Section = { kind: 'section', start: 0, end: content.text.length, item };
    return new BoundText(content.text, [...content.marks, mark]);
  }

  /** A footnote's marker. */
  static noteMarker(marker: string): BoundText {
    const mark: NoteMarker = { kind: 'note', start: 0, end: marker.length };
    return new BoundText(marker, [mark]);
  }

  /** One end of a document link to `item`. */
  static linkEdge(text: string, link: string, edge: LinkEdge['edge']): BoundText {
    return new BoundText(text, [{ kind: 'link', start: 0, end: text.length, link, edge }]);
  }

  /** Part of the heading of section `item`. */
  static headingPart(content: BoundText, item: string, part: HeadingPart['part']): BoundText {
    const mark: HeadingPart = {
      kind: 'heading',
      start: 0,
      end: content.text.length,
      heading: item,
      part,
    };
    return new BoundText(content.text, [...content.marks, mark]);
  }

  /** Text whose placeholders wait for the replacements. */
  static deferred(text: string): BoundText {
    const mark: Deferred = { kind: 'deferred', start: 0, end: text.length };
    return new BoundText(text, [mark]);
  }

  /** The parts one after another, with `separator` between them. */
  static join(parts: readonly (string | BoundText)[], separator = ''): BoundText {
    let text = '';
    const marks: Mark[] = [];
    parts.forEach((part, index) => {
      if (index > 0) text += separator;
      const bound = typeof part === 'string' ? BoundText.of(part) : part;
      const offset = text.length;
      for (const mark of bound.marks) {
        marks.push({ ...mark, start: mark.start + offset, end: mark.end + offset });
      }
      text += bound.text;
    });
    return new BoundText(text, marks);
  }

  /** Replaces each match of the global `pattern` with what `replacer` returns. */
  replace(pattern: RegExp, replacer: (match: RegExpExecArray) => string): BoundText {
    const edits = [...this.text.matchAll(pattern)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      text: replacer(match),
    }));
    return this.edit(edits);
  }

  /**
   * Makes the edits, which must be in order and must not overlap.  Marks work as Scrivener's text
   * attributes do: text left alone keeps its own, and an edit's text takes those of the first
   * character it replaces.
   */
  edit(edits: readonly Edit[]): BoundText {
    if (edits.length === 0) return this;
    const pieces: string[] = [];
    let length = 0;
    let last = 0;
    // Where each edit's text lands, and how far the edits up to it move the text after it.
    const placed: number[] = [];
    const shifts: number[] = [];
    for (const edit of edits) {
      const kept = this.text.slice(last, edit.start);
      pieces.push(kept, edit.text);
      placed.push(length + kept.length);
      length += kept.length + edit.text.length;
      shifts.push((shifts.at(-1) ?? 0) + edit.text.length - (edit.end - edit.start));
      last = edit.end;
    }
    pieces.push(this.text.slice(last));
    // The first edit that ends after `offset`: the edits are in order, so their ends are too.
    const firstEndingAfter = (offset: number) => {
      let low = 0;
      let high = edits.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (edits[middle]!.end <= offset) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    // Where a character left alone lands in the new text.
    const moved = (offset: number) => offset + (shifts[firstEndingAfter(offset) - 1] ?? 0);
    const marks = this.marks.flatMap((mark) => {
      let start: number | undefined;
      let end = 0;
      const take = (from: number, to: number) => {
        if (from >= to) return;
        start ??= from;
        end = to;
      };
      let cursor = mark.start;
      for (let index = firstEndingAfter(mark.start); index < edits.length; index += 1) {
        const edit = edits[index]!;
        if (edit.start >= mark.end) break;
        if (cursor < edit.start) take(moved(cursor), moved(cursor) + edit.start - cursor);
        if (edit.start >= mark.start) take(placed[index]!, placed[index]! + edit.text.length);
        cursor = Math.max(cursor, edit.end);
      }
      if (cursor < mark.end) take(moved(cursor), moved(cursor) + mark.end - cursor);
      // A paragraph or section with no text still has its place in the text.
      if ((mark.kind === 'source' || mark.kind === 'section') && mark.start === mark.end) {
        return [{ ...mark, start: moved(mark.start), end: moved(mark.start) }];
      }
      return start === undefined ? [] : [{ ...mark, start, end }];
    });
    return new BoundText(pieces.join(''), marks);
  }

  /** The text of each item's sections, in order, by the item's binder ID. */
  sections(): Map<string, string[]> {
    const sections = new Map<string, string[]>();
    const ordered = this.marks.filter(ofKind('section')).toSorted((a, b) => a.start - b.start);
    for (const { item, start, end } of ordered) {
      sections.set(item, [...(sections.get(item) ?? []), this.text.slice(start, end)]);
    }
    return sections;
  }

  /** The item bound to the whole range from `start` to `end`, if one is. */
  itemAt(start: number, end: number): string | undefined {
    const binding = this.marks
      .filter(ofKind('binding'))
      .find((mark) => mark.start <= start && end <= mark.end);
    return binding?.item;
  }

  /** Whether a binding covers part of the range from `start` to `end`, but not all of it. */
  isPartlyBound(start: number, end: number): boolean {
    return (
      this.itemAt(start, end) === undefined &&
      this.marks.some((mark) => mark.kind === 'binding' && mark.start < end && start < mark.end)
    );
  }

  /** Whether the whole range from `start` to `end` waits for the replacements. */
  isDeferred(start: number, end: number): boolean {
    return this.marks.some(
      (mark) => mark.kind === 'deferred' && mark.start <= start && end <= mark.end,
    );
  }

  /**
   * When the text ends with a list, the line breaks after the list's last line; nothing when
   * other text follows it.
   */
  breaksAfterList(): number | undefined {
    const lists = this.marks.filter(ofKind('list'));
    const end = Math.max(-1, ...lists.map((mark) => mark.end));
    const after = this.text.slice(Math.max(end, 0));
    return end >= 0 && after === '\n'.repeat(after.length) ? after.length : undefined;
  }

  /** The text of each part of each section's heading, by the section's binder ID. */
  headings(): Map<string, HeadingParts> {
    const headings = new Map<string, HeadingParts>();
    for (const mark of this.marks) {
      if (mark.kind !== 'heading') continue;
      const parts = headings.get(mark.heading) ?? {};
      parts[mark.part] = this.text.slice(mark.start, mark.end);
      headings.set(mark.heading, parts);
    }
    return headings;
  }

  /** Writes each document link as `write` has it. */
  writeLinks(write: LinkWriter): BoundText {
    const edges = this.marks.filter(ofKind('link')).toSorted((a, b) => a.start - b.start);
    const edits: Edit[] = [];
    for (let index = 0; index + 1 < edges.length; index += 2) {
      const open = edges[index]!;
      const close = edges[index + 1]!;
      const text = this.text.slice(open.end, close.start);
      const written = write(open.link, text);
      if (!written) {
        edits.push({ start: open.start, end: open.end, text: '' });
        edits.push({ start: close.start, end: close.end, text: '' });
        continue;
      }
      if (written.text !== text)
        edits.push({ start: open.end, end: close.start, text: written.text });
      edits.push({ start: close.start, end: close.end, text: linkEnd(written) });
    }
    return this.edit(edits);
  }

  /** The text without the layout's: the document's own. */
  ownText(): string {
    const layout = this.marks.filter(ofKind('deferred')).toSorted((a, b) => a.start - b.start);
    let own = '';
    let last = 0;
    for (const { start, end } of layout) {
      own += this.text.slice(last, Math.max(last, start));
      last = Math.max(last, end);
    }
    return own + this.text.slice(last);
  }

  /** Where the text's last paragraph starts, layout text at its end aside. */
  lastParagraphStart(): number {
    const layout = this.marks.find(
      (mark) => mark.kind === 'deferred' && mark.end === this.text.length && mark.start < mark.end,
    );
    const end = layout ? layout.start : this.text.length;
    return this.text.lastIndexOf('\n', end - 1) + 1;
  }

  /** Whether the text ends with a footnote's marker. */
  endsWithNote(): boolean {
    return this.marks.some((mark) => mark.kind === 'note' && mark.end === this.text.length);
  }

  /**
   * The finished text, with each trimmed range written as Scrivener writes it, innermost first:
   * a trimmed range can hold another, as the metadata block holds the metadata document.
   */
  finish(): BoundText {
    const pending = this.marks.filter(ofKind('trimmed'));
    if (pending.length === 0) return this;
    // In order, outer ranges before the ones they hold: a range the next one does not start
    // inside holds no other, and those never overlap.
    const ordered = pending.toSorted((a, b) => a.start - b.start || b.end - a.end);
    const innermost = ordered.filter(
      (mark, index) => (ordered[index + 1]?.start ?? Infinity) >= mark.end,
    );
    const edits = innermost.flatMap(({ start, end, trim }) => {
      const content = this.text.slice(start, end);
      const trimmed = TRIMS[trim](content);
      return trimmed === content ? [] : [{ start, end, text: trimmed }];
    });
    const done = new Set<Mark>(innermost);
    const marks = this.marks.filter((mark) => !done.has(mark));
    return new BoundText(this.text, marks).edit(edits).finish();
  }
}
