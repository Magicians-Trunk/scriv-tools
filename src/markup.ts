import {
  LINE_BREAK,
  PICTURE_CHARACTER,
  type Picture,
  same,
  type CharacterFormat,
  type Run,
} from './rich-text.ts';
import { type Placeholder, placeholderText, readPlaceholders } from './placeholder-syntax.ts';
import { hyperlinkTarget, type LinkTarget, linkTarget } from './link-target.ts';

/**
 * A paragraph's content, read once from the RTF: text, line breaks, links, placeholders, and
 * Scrivener's markup, which the RTF stores as literal text: style markers (`<$Scr_Ps::0>` starts
 * the paragraph style the document's `content.styles` lists first), heading and keep-with-next
 * markers, linked images, and inline footnotes, annotations and Preserve Formatting
 * (`{\Scrv_fn=…\end_Scrv_fn}`).
 *
 * Everything written carries the character formatting it was written in.  Nothing is left out:
 * written back (`markupRuns`), the nodes give the paragraph's text and formatting as they were.
 * Struck-through text is formatting like any other; the compile deletes it when its options say.
 */
export type MarkupNode =
  | ({ kind: 'text'; text: string } & Formatted)
  | ({ kind: 'break' } & Formatted)
  | PlaceholderNode
  | StyleMarker
  /** A heading (`<$Scr_H::1>`) or keep-with-next marker, which a MultiMarkdown compile skips. */
  | ({ kind: 'tag'; source: string } & Formatted)
  | { kind: 'link'; target: LinkTarget; content: MarkupNode[] }
  /** A picture embedded in the document. */
  | ({ kind: 'picture'; picture: Picture } & Formatted)
  /** An image linked by its path rather than embedded, as written. */
  | ({ kind: 'image'; path: string; source: string } & Formatted)
  | ({ kind: 'footnote' } & Span)
  /** An annotation: its opening as written (`{\Scrv_annot \color=…\text=`), with its colour. */
  | ({ kind: 'annotation'; opening: string } & Span)
  /** Preserve Formatting, whose text the compile keeps as it is. */
  | ({ kind: 'preserved' } & Span);

/**
 * The character formatting something is written in.  Markup written across a change of
 * formatting has each part's, in `mixed`, by length, in order; `format` is then the first.
 */
export interface Formatted {
  format: CharacterFormat;
  mixed?: { length: number; format: CharacterFormat }[];
}

/**
 * A footnote, annotation or Preserve Formatting: its text, and how its two ends are written.  One
 * that runs across paragraphs is a part in each: the part an end is not in has none.
 */
export interface Span {
  content: MarkupNode[];
  open?: Formatted;
  close?: Formatted;
}

/** A span by its kind, whichever it is. */
export type SpanNode = Extract<MarkupNode, { kind: 'footnote' | 'annotation' | 'preserved' }>;

/** Whether a node is a footnote, annotation or Preserve Formatting. */
export const isSpan = (node: MarkupNode): node is SpanNode =>
  node.kind === 'footnote' || node.kind === 'annotation' || node.kind === 'preserved';

/** Whether a span goes on past the end of its paragraph. */
export const runsOn = (node: MarkupNode) => isSpan(node) && !node.close;

/** Whether a span comes from before the start of its paragraph. */
export const runsIn = (node: MarkupNode) => isSpan(node) && !node.open;

/**
 * A placeholder written whole in one run of text, in that run's formatting.  Text the compile
 * reads as one, a placeholder across a style marker, a link's end or a change of formatting,
 * stays text here.
 */
export interface PlaceholderNode extends Placeholder {
  format: CharacterFormat;
}

/** A text's placeholders as nodes, the text between them as text, all in `format`. */
function withPlaceholders(text: string, format: CharacterFormat): MarkupNode[] {
  return readPlaceholders(text).map((part) => ({ ...part, format }));
}

/** Scrivener's tag around a heading's text: `<$Scr_H::2>`, closed by `<!$Scr_H::2>`. */
const HEADING_TAG = /^<(?<closing>!?)\$Scr_H::(?<level>\d+)>$/;

/** A heading tag's level and which end it is; nothing for any other node. */
export function headingTagOf(node: MarkupNode): { level: number; closing: boolean } | undefined {
  const tag = node.kind === 'tag' ? HEADING_TAG.exec(node.source)?.groups : undefined;
  return tag && { level: Number(tag.level), closing: tag.closing !== '' };
}

export interface StyleMarker extends Formatted {
  kind: 'style';
  scope: 'paragraph' | 'character';
  /** Which of the styles the document's `content.styles` lists, counting from 0. */
  index: number;
  closing: boolean;
  /** The marker as written. */
  source: string;
}

type SpanKind = SpanNode['kind'];

/**
 * Scrivener's markup tokens.  Style markers name a paragraph (`Ps`) or character (`Cs`) style;
 * heading (`H`) and keep-with-next markers carry nothing a MultiMarkdown compile uses.  An
 * annotation's opening runs through its colour to `\text=`.  A linked image gives its size, then
 * its path.
 */
const TOKEN = new RegExp(
  [
    String.raw`<(?<closing>!?)\$Scr_(?<scope>Ps|Cs)::(?<index>\d+)>`,
    String.raw`<!?\$Scr_H::\d+>`,
    String.raw`<!?\$ScrKeepWithNext>`,
    String.raw`\{\\Scrv_(?<opening>fn|ps)=`,
    String.raw`\{\\Scrv_(?<annotation>annot) [\s\S]*?\\text=`,
    String.raw`\\end_Scrv_(?<ending>fn|annot|ps)\}`,
    String.raw`\{\$SCRImageLink\[[^\]]*\]=(?<image>[^}]*)\}`,
  ].join('|'),
  'g',
);

const SPANS: Record<string, SpanKind> = { fn: 'footnote', annot: 'annotation', ps: 'preserved' };

/** How each span's ends are written, its opening as Scrivener writes it when it has no colour. */
const SPAN_ENDS: Record<SpanKind, [string, string]> = {
  footnote: ['{\\Scrv_fn=', '\\end_Scrv_fn}'],
  annotation: ['{\\Scrv_annot ', '\\end_Scrv_annot}'],
  preserved: ['{\\Scrv_ps=', '\\end_Scrv_ps}'],
};

/** A span being read: how it opened, and `open` when its opening is in this paragraph. */
interface OpenSpan {
  kind: SpanKind;
  opening: string;
  open?: Formatted;
}

interface Frame {
  span?: OpenSpan;
  nodes: MarkupNode[];
  /** Inside an annotation, where markup is kept as typed. */
  literal: boolean;
}

/** A span's node, from its frame's text and its ends. */
function spanNode({ kind, opening, open }: OpenSpan, content: MarkupNode[], close?: Formatted) {
  const ends = { content, ...(open ? { open } : {}), ...(close ? { close } : {}) };
  return kind === 'annotation' ? { kind, opening, ...ends } : { kind, ...ends };
}

/**
 * Reads a paragraph's markup.  Inside an annotation, Scrivener's markup is kept as typed.  Text
 * keeps its formatting, run by run; markup takes that of the characters it is written in.
 */
export function parseMarkup(runs: Run[]): MarkupNode[] {
  return splitPlaceholders(new MarkupReader(false).read(runs));
}

/** Reads a document's paragraphs' markup: a span still open where one ends goes on in the next. */
export function parseParagraphs(paragraphs: Run[][]): MarkupNode[][] {
  let open: OpenSpan[] = [];
  return paragraphs.map((runs) => {
    const reader = new MarkupReader(false, open);
    const nodes = splitPlaceholders(reader.read(runs));
    open = reader.left;
    return nodes;
  });
}

/** Reads markup from formatted text, one paragraph (or one link's text) at a time. */
class MarkupReader {
  private readonly frames: Frame[];
  /** The text since the last link or line break, and the formatting of each of its characters. */
  private pending = '';
  private formats: CharacterFormat[] = [];

  /** The spans still open at the end of what was read, outermost first. */
  left: OpenSpan[] = [];

  /** `literal`: inside an annotation.  `going`: the spans still open from the paragraph before. */
  constructor(literal: boolean, going: OpenSpan[] = []) {
    this.frames = [{ nodes: [], literal }];
    for (const { kind, opening } of going) this.openSpan({ kind, opening });
  }

  private openSpan(span: OpenSpan): void {
    const literal = this.top().literal || span.kind === 'annotation';
    this.frames.push({ span, nodes: [], literal });
  }

  /** Reads runs; a hyperlink field's runs are a link, read as its text, unless `inLink`. */
  read(runs: Run[], inLink = false): MarkupNode[] {
    let index = 0;
    while (index < runs.length) {
      const { field } = runs[index]!.format;
      const target = field === undefined || inLink ? undefined : hyperlinkTarget(field);
      if (target === undefined) {
        this.addRun(runs[index]!);
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < runs.length && runs[end]!.format.field === field) end += 1;
      this.scan();
      const content = new MarkupReader(this.top().literal).read(runs.slice(index, end), true);
      this.add({ kind: 'link', target: linkTarget(target), content });
      index = end;
    }
    this.scan();
    return this.endSpans();
  }

  /** What was read, with each span still open a part that goes on past it. */
  private endSpans(): MarkupNode[] {
    this.left = this.frames.flatMap(({ span }) => (span ? [span] : []));
    while (this.frames.length > 1) {
      const { span, nodes } = this.frames.pop()!;
      this.add(spanNode(span!, nodes));
    }
    return this.top().nodes;
  }

  private top(): Frame {
    return this.frames.at(-1)!;
  }

  private add(node: MarkupNode): void {
    this.top().nodes.push(node);
  }

  /** A run's text joins the pending text; a line break ends it. */
  private addRun({ text, format: { picture, ...format } }: Run): void {
    if (picture) {
      this.scan();
      for (let at = 0; at < text.length; at += 1) this.add({ kind: 'picture', picture, format });
      return;
    }
    text.split(LINE_BREAK).forEach((piece, index) => {
      if (index > 0) {
        this.scan();
        this.add({ kind: 'break', format });
      }
      this.pending += piece;
      for (let at = 0; at < piece.length; at += 1) this.formats.push(format);
    });
  }

  /** Reads the pending text's markup, and the text between it. */
  private scan(): void {
    let last = 0;
    for (const match of this.pending.matchAll(TOKEN)) {
      this.addText(last, match.index);
      last = match.index + match[0].length;
      this.token(match);
    }
    this.addText(last, this.pending.length);
    this.pending = '';
    this.formats = [];
  }

  /** One piece of Scrivener's markup. */
  private token(match: RegExpExecArray): void {
    const [whole] = match;
    const end = match.index + whole.length;
    const written = this.formatted(match.index, end);
    const { closing, scope, index, ending, image } = match.groups!;
    const opening = match.groups!.opening ?? match.groups!.annotation;
    const span = this.top().span;
    if (ending !== undefined) {
      const kind = SPANS[ending]!;
      if (span?.kind !== kind) return this.addText(match.index, end);
      const { nodes } = this.frames.pop()!;
      this.add(spanNode(span, nodes, written));
    } else if (this.top().literal) {
      this.addText(match.index, end);
    } else if (opening !== undefined) {
      this.openSpan({ kind: SPANS[opening]!, opening: whole, open: written });
    } else if (image !== undefined) {
      this.add({ kind: 'image', path: image, source: whole, ...written });
    } else if (scope !== undefined) {
      this.add({
        kind: 'style',
        scope: scope === 'Ps' ? 'paragraph' : 'character',
        index: Number(index),
        closing: closing === '!',
        source: whole,
        ...written,
      });
    } else this.add({ kind: 'tag', source: whole, ...written });
  }

  /** The pending text from `start` to `end`, a node for each run of one formatting. */
  private addText(start: number, end: number): void {
    const { formats } = this;
    let from = start;
    for (let at = start + 1; at <= end; at += 1) {
      if (at < end && formats[at] === formats[from]) continue;
      const text = this.pending.slice(from, at);
      const last = this.top().nodes.at(-1);
      if (last?.kind === 'text' && last.format === formats[from]) last.text += text;
      else this.add({ kind: 'text', text, format: formats[from]! });
      from = at;
    }
  }

  /** The formatting of the pending characters from `start` to `end`. */
  private formatted(start: number, end: number): Formatted {
    const mixed: { length: number; format: CharacterFormat }[] = [];
    for (let at = start; at < end; at += 1) {
      const last = mixed.at(-1);
      if (last && last.format === this.formats[at]) last.length += 1;
      else mixed.push({ length: 1, format: this.formats[at]! });
    }
    const [first, ...rest] = mixed;
    return rest.length === 0 ? { format: first!.format } : { format: first!.format, mixed };
  }
}

/** Markup with each text's placeholders as nodes of their own, in the text's formatting. */
function splitPlaceholders(nodes: MarkupNode[]): MarkupNode[] {
  return nodes.flatMap((node): MarkupNode[] => {
    if (node.kind === 'text') return withPlaceholders(node.text, node.format);
    if ('content' in node) return [{ ...node, content: splitPlaceholders(node.content) }];
    return [node];
  });
}

/**
 * Markup as runs of formatted text, as it is written: the paragraph's text and formatting as the
 * document has them.  Runs next to each other in one formatting are one.
 */
export function markupRuns(nodes: MarkupNode[]): Run[] {
  const runs: Run[] = [];
  const add = (text: string, format: CharacterFormat) => {
    const last = runs.at(-1);
    if (last && same(last.format, format)) last.text += text;
    else runs.push({ text, format });
  };
  const write = (text: string, { format, mixed }: Formatted) => {
    if (!mixed) return add(text, format);
    let at = 0;
    for (const part of mixed) {
      add(text.slice(at, at + part.length), part.format);
      at += part.length;
    }
  };
  const visit = (node: MarkupNode): void => {
    switch (node.kind) {
      case 'text':
        return write(node.text, node);
      case 'break':
        return write(LINE_BREAK, node);
      case 'placeholder':
        return write(placeholderText(node), node);
      case 'style':
      case 'tag':
      case 'image':
        return write(node.source, node);
      case 'picture':
        return add(PICTURE_CHARACTER, { ...node.format, picture: node.picture });
      case 'link':
        return node.content.forEach(visit);
      default: {
        const [opening, closing] = SPAN_ENDS[node.kind];
        if (node.open) write(node.kind === 'annotation' ? node.opening : opening, node.open);
        node.content.forEach(visit);
        if (node.close) write(closing, node.close);
        return;
      }
    }
  };
  nodes.forEach(visit);
  return runs;
}

/** The text a text or placeholder node writes; nothing for other markup. */
export function writtenText(node: MarkupNode): string | undefined {
  if (node.kind === 'text') return node.text;
  return node.kind === 'placeholder' ? placeholderText(node) : undefined;
}

/** The text of markup as it reads: link text included, markers, notes and images left out. */
export const markupText = (nodes: MarkupNode[]) => textWithImages(nodes, () => '');

/** The text of markup as it reads, with each linked image as `image` says of its path. */
export function textWithImages(nodes: MarkupNode[], image: (path: string) => string): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text') return node.text;
      if (node.kind === 'placeholder') return placeholderText(node);
      if (node.kind === 'break') return LINE_BREAK;
      if (node.kind === 'image') return image(node.path);
      return node.kind === 'link' ? textWithImages(node.content, image) : '';
    })
    .join('');
}
