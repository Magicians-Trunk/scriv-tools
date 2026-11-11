import type { CompileFormat, FormatStyle } from './compile-format.ts';
import type { DirectLook, ResolvedNode, RichTextOptions } from './resolve-markup.ts';
import { type OutputNode, insertAfter, isBlank, markup, text } from './output.ts';
import { UnsupportedError } from './unsupported.ts';

/** The styles a format gives MultiMarkdown's own meanings. */
type StyleFunctions = Pick<CompileFormat, 'codeSpanStyle' | 'blockQuoteStyle' | 'codeBlockStyle'>;

/** A format style, with the name the document's style markers give it. */
export interface NamedStyle {
  name: string;
  style: FormatStyle;
}

/** The styles open where a paragraph starts, or ends: they carry on from one to the next. */
export interface OpenStyles {
  /** The open paragraph style; the section layout's style for the text when none is. */
  paragraph: NamedStyle | undefined;
  character: NamedStyle | undefined;
}

/** What building paragraphs reads: the format's styles, and the layout's style for the text. */
export interface StyleEnvironment {
  format: StyleFunctions;
  styleOf: (name: string) => NamedStyle;
  textStyle: NamedStyle | undefined;
  /** Convert rich text to MultiMarkdown, when it is on. */
  richText?: RichTextOptions;
}

/** A paragraph's output, before any list marker, and the styles open after it. */
export interface BuiltParagraph {
  nodes: OutputNode[];
  style?: string;
  /** The prefix of a paragraph style that starts in this paragraph. */
  openedPrefix?: OutputNode;
  /** The paragraph starts in a style that deletes its text. */
  deleted: boolean;
  open: OpenStyles;
  /** Suffixes of paragraph styles that end before the paragraph has any text: the line before's. */
  suffixesBefore: string[];
  /** Scrivener markup written out as it is, like a style ending with no style open. */
  leftAsWritten: string[];
}

export const NO_STYLE: FormatStyle = {
  prefix: '',
  suffix: '',
  paraPrefix: '',
  deleteText: false,
  paragraphOnly: false,
  rawMarkup: false,
};

type RunNode = Extract<OutputNode, { kind: 'run' }>;
type TextOutput = Extract<OutputNode, { kind: 'text' }>;

/**
 * The bold or italic run written last, while nothing else has been written after it but the
 * whitespace at its end, which MultiMarkdown needs outside its markers.  Text in the same look
 * straight after runs on in it.
 */
interface LookRun {
  marker: string;
  run: RunNode;
  trail?: TextOutput;
}

/** Markdown's punctuation, which converting rich text escapes so the text reads as typed. */
const MARKDOWN_PUNCTUATION = /[\\`*_[\]]/g;

/** MultiMarkdown's markers for bold, italic, or both; none for neither. */
function lookMarker({ bold, italic }: DirectLook): string {
  return (bold ? '**' : '') + (italic ? '*' : '');
}

/** Whitespace at either end of text, and the text between; all whitespace is all `lead`. */
function ends(segment: string): { lead: string; core: string; trail: string } {
  const start = segment.length - segment.trimStart().length;
  const core = segment.trim();
  return { lead: segment.slice(0, start), core, trail: segment.slice(start + core.length) };
}

/** Where output goes while a paragraph is built: the paragraph, a footnote, or a style's run. */
type Frame =
  | { kind: 'paragraph' | 'footnote'; children: OutputNode[] }
  | { kind: 'run'; children: OutputNode[]; run: RunNode; style: NamedStyle };

/**
 * The character style run that ended last, while nothing has been written after it.  Scrivener
 * writes a style's prefix and suffix around the longest range in the style, and they take the
 * style themselves; it deletes text as it goes.  So the style starting again straight after runs
 * on, and starting again after deleted text takes in the run before, prefix and suffix and all.
 */
interface EndedRun {
  run: RunNode;
  style: NamedStyle;
  /** Where the run is. */
  frame: Frame;
  /** Text was deleted since the run ended. */
  deleted: boolean;
}

/** Builds a paragraph's output, where `open` styles carry on from the paragraph before. */
export function buildParagraph(
  nodes: ResolvedNode[],
  open: OpenStyles,
  environment: StyleEnvironment,
): BuiltParagraph {
  return new Paragraph({ ...open }, environment).build(nodes);
}

/** A character style's prefix and suffix; a code span also gets MultiMarkdown's backticks. */
export function styleEnds({ name, style }: NamedStyle, format: StyleFunctions) {
  const tick = name === format.codeSpanStyle ? '`' : '';
  return { open: tick + style.prefix, close: style.suffix + tick };
}

function styleRun(style: NamedStyle, format: StyleFunctions): RunNode {
  return { kind: 'run', ...styleEnds(style, format), children: [] };
}

/** One paragraph's output, as its nodes are visited. */
class Paragraph {
  /** The styles open as the paragraph goes, and after it. */
  private readonly open: OpenStyles;
  private readonly environment: StyleEnvironment;
  private readonly suffixesBefore: string[] = [];
  private readonly leftAsWritten: string[] = [];
  private readonly root: OutputNode[] = [];
  private readonly frames: Frame[] = [{ kind: 'paragraph', children: this.root }];
  private atStart = true;
  /** The paragraph style the line starts in. */
  private lineStyle: NamedStyle | undefined;
  private openedPrefix: OutputNode | undefined;
  /** A paragraph style opened before any text, and its prefix. */
  private start: { style: NamedStyle; prefix: OutputNode } | undefined;
  private ended: EndedRun | undefined;
  private look: LookRun | undefined;

  constructor(open: OpenStyles, environment: StyleEnvironment) {
    this.open = open;
    this.environment = environment;
  }

  build(nodes: ResolvedNode[]): BuiltParagraph {
    if (this.open.character) this.openRun(this.open.character);
    for (const node of nodes) this.visit(node);
    if (this.atStart) this.lineStyle = this.open.paragraph;
    const { root, lineStyle } = this;
    if (!isBlank(root) && lineStyle) {
      // The style's paragraph prefix follows its own prefix, where the style opens here, and
      // MultiMarkdown's line markers (`> `, a tab) come first of all.
      const paraPrefix = markup(lineStyle.style.paraPrefix);
      if (lineStyle === this.start?.style) insertAfter(root, this.start.prefix, paraPrefix);
      else root.unshift(paraPrefix);
      root.unshift(markup(lineMarker(lineStyle.name, this.environment.format)));
    }
    const built: BuiltParagraph = {
      nodes: root,
      deleted: lineStyle?.style.deleteText === true,
      open: this.open,
      suffixesBefore: this.suffixesBefore,
      leftAsWritten: this.leftAsWritten,
    };
    if (lineStyle) built.style = lineStyle.name;
    if (this.openedPrefix !== undefined) built.openedPrefix = this.openedPrefix;
    return built;
  }

  private top(): Frame {
    return this.frames.at(-1)!;
  }

  private add(node: OutputNode): void {
    this.look = undefined;
    this.place(node);
  }

  /** Writes a node where output goes, leaving any bold or italic run able to run on. */
  private place(node: OutputNode): void {
    this.ended = undefined;
    this.top().children.push(node);
  }

  private openRun(style: NamedStyle): void {
    const { ended } = this;
    const resumes = ended?.style.name === style.name && ended.frame === this.top();
    const run = resumes && !ended.deleted ? ended.run : styleRun(style, this.environment.format);
    if (resumes && ended.deleted) {
      const siblings = ended.frame.children;
      siblings.splice(siblings.indexOf(ended.run), 1);
      run.children.push(ended.run);
    }
    // A deleting style's run writes nothing, so the run before it is still the last one.
    if (style.style.deleteText) this.top().children.push(run);
    else if (run !== ended?.run) this.add(run);
    this.frames.push({ kind: 'run', children: run.children, run, style });
  }

  private closeRun(): void {
    const frame = this.top();
    if (frame.kind !== 'run') return;
    this.frames.pop();
    const { run, style } = frame;
    if (style.style.deleteText) return;
    this.ended = { run, style, frame: this.top(), deleted: false };
  }

  private visit(node: ResolvedNode): void {
    if (node.kind === 'text' && node.look) this.addConverted(node.text, node.look);
    else if (node.kind === 'text') this.addText(node.text, undefined, node.written);
    else if (node.kind === 'bound' || node.kind === 'edge') this.addText(node.text, node);
    else if (node.kind === 'footnote') this.addFootnote(node.content);
    else if (node.kind === 'included') this.addIncluded(node.content);
    else if (node.kind === 'include') {
      throw new UnsupportedError('an included document inside a footnote or link');
    } else if (node.scope === 'character') {
      // An ending that does not name the open character style is written as it is.
      if (node.closing && this.open.character?.name !== node.name) {
        this.leftAsWritten.push(node.source);
        this.addText(node.source);
        return;
      }
      const opened = this.environment.styleOf(node.name);
      this.closeRun();
      if (!node.closing) this.openRun(opened);
      this.open.character = node.closing ? undefined : opened;
    } else if (node.closing) this.closeParagraphStyle(this.environment.styleOf(node.name));
    else this.openParagraphStyle(this.environment.styleOf(node.name));
  }

  /**
   * Adds the document's text; text that describes another item, or ends a link to one, keeps
   * that item with it.
   */
  private addText(
    segment: string,
    marked?: Extract<OutputNode, { kind: 'bound' | 'edge' }>,
    written?: true,
  ): void {
    if (!this.takesText(segment)) return;
    this.add(marked ?? (written ? { kind: 'text', text: segment, written } : text(segment)));
  }

  /** Text starts the line if nothing has; false when there is none, or a style deletes it. */
  private takesText(segment: string): boolean {
    if (segment === '') return false;
    const { paragraph, character } = this.open;
    if (this.atStart) this.lineStyle = paragraph;
    this.atStart = false;
    if (paragraph?.style.deleteText || character?.style.deleteText) {
      if (this.ended) this.ended.deleted = true;
      return false;
    }
    return true;
  }

  /** Whether the open styles keep their text as typed: raw markup, a code span or block. */
  private keepsAsTyped(): boolean {
    const { codeSpanStyle, codeBlockStyle } = this.environment.format;
    return [this.open.paragraph, this.open.character].some(
      (open) =>
        open !== undefined &&
        (open.style.rawMarkup || open.name === codeSpanStyle || open.name === codeBlockStyle),
    );
  }

  /**
   * The document's text, converted from rich text to MultiMarkdown: its punctuation escaped when
   * the option says, and bold and italic between their markers, with whitespace outside them.
   */
  private addConverted(segment: string, look: DirectLook): void {
    if (this.keepsAsTyped()) return this.addText(segment);
    const escaped =
      this.environment.richText?.escape === true
        ? segment.replaceAll(MARKDOWN_PUNCTUATION, String.raw`\$&`)
        : segment;
    const marker = lookMarker(look);
    if (marker === '') return this.addText(escaped);
    if (!this.takesText(escaped)) return;
    const { lead, core, trail } = ends(escaped);
    const children = this.top().children;
    const last = this.look;
    const runsOn = last?.marker === marker && children.at(-1) === (last.trail ?? last.run);
    if (runsOn && core === '') {
      if (last.trail) last.trail.text += lead;
      else this.placeTrail(last, lead);
      return;
    }
    if (runsOn) {
      if (last.trail) last.run.children.push(children.pop()!);
      last.run.children.push(text(lead + core));
      delete last.trail;
      if (trail) this.placeTrail(last, trail);
      return;
    }
    if (core === '') return this.add(text(escaped));
    if (lead) this.add(text(lead));
    const run: RunNode = { kind: 'run', open: marker, close: marker, children: [text(core)] };
    this.add(run);
    const opened: LookRun = { marker, run };
    this.look = opened;
    if (trail) this.placeTrail(opened, trail);
  }

  /** Whitespace after a bold or italic run, outside its markers, which may yet run on. */
  private placeTrail(look: LookRun, whitespace: string): void {
    const trail: TextOutput = { kind: 'text', text: whitespace };
    this.place(trail);
    look.trail = trail;
  }

  /**
   * A footnote's text takes the character style open where it starts, and a character style can
   * start or end inside it.
   */
  private addFootnote(content: ResolvedNode[]): void {
    const note: OutputNode = { kind: 'footnote', children: [] };
    this.add(note);
    const depth = this.frames.push({ kind: 'footnote', children: note.children });
    if (this.open.character) this.openRun(this.open.character);
    for (const node of content) this.visit(node);
    this.frames.length = depth - 1;
    const { character } = this.open;
    if (character && this.top().kind !== 'run') this.openRun(character);
    if (!character) this.closeRun();
  }

  /** Included text keeps its own styles: the styles open around it are open again after it. */
  private addIncluded(content: ResolvedNode[]): void {
    const { character, paragraph } = this.open;
    const before = [...this.frames];
    for (const node of content) this.visit(node);
    // Back to the frames that were open before and still are; a run closed inside starts again.
    let kept = 0;
    while (kept < before.length && this.frames[kept] === before[kept]) kept += 1;
    this.frames.length = kept;
    this.open.character = character;
    this.open.paragraph = paragraph;
    if (character && this.top().kind !== 'run') this.openRun(character);
  }

  private closeParagraphStyle({ style }: NamedStyle): void {
    if (this.atStart) this.suffixesBefore.push(style.suffix);
    else this.add(markup(style.suffix));
    this.open.paragraph = this.environment.textStyle;
  }

  private openParagraphStyle(opened: NamedStyle): void {
    const prefix = markup(opened.style.prefix);
    // A style that sets no character attributes opens before any character style that opened at
    // the start of the paragraph.
    if (this.atStart && opened.style.paragraphOnly) this.root.unshift(prefix);
    else this.add(prefix);
    this.open.paragraph = opened;
    if (this.atStart) this.start = { style: opened, prefix };
    if (opened.style.prefix) this.openedPrefix = prefix;
  }
}

/** What MultiMarkdown needs at the start of each line of a block quote or code block. */
export function lineMarker(name: string, format: StyleFunctions): string {
  if (name === format.blockQuoteStyle) return '> ';
  return name === format.codeBlockStyle ? '\t' : '';
}
