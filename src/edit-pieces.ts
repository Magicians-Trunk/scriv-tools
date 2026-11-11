/** The pieces of a paragraph: what they are, how they are written, and how styles look. */
import { type Files, hexOf } from './files.ts';
import * as path from 'pathe';
import { imageSize } from 'image-size';
import type { DocumentText } from './document.ts';
import { listShape, type ListShape } from './edit-lists.ts';
import {
  type Open,
  openAfter,
  openAt,
  openAtText,
  opensAt,
  type Paragraph,
  styleMarker,
} from './edit-markers.ts';
import { linkField, type LinkTarget } from './link-target.ts';
import { isSpan, markupText, type MarkupNode, runsOn } from './markup.ts';
import type { Project } from './project.ts';
import type { ProjectStyle } from './project-styles.ts';
import type { CharacterFormat, Picture } from './rich-text.ts';

/** What a paragraph holds that is no part of its text as it reads. */
export type NoteKind = 'footnote' | 'annotation' | 'preserved' | 'image' | 'picture';

/**
 * A piece of a paragraph: its text, the character style it is in, named as the project names it,
 * and what else it is.  `bold` and `italic` say what the paragraph's style does not.  A `note`
 * holds the note's text, or an image's path, and is no part of the text around it.
 */
export interface Inline {
  text: string;
  style?: string;
  link?: LinkTarget;
  bold?: true;
  italic?: true;
  note?: NoteKind;
  /** Text Scrivener reads as a placeholder, when a reader asks to know. */
  placeholder?: true;
  /** The size a new picture or image shows at, when not its file's own. */
  size?: Size;
}

/**
 * A paragraph to add: its paragraph style, named as the project names it, and its text.  Its HTML
 * header level is the style's, unless it is given one.
 */
export interface NewParagraph {
  style?: string;
  level?: number;
  text: string | Inline[];
  /** A list item, whether or not its style makes it one. */
  list?: ListShape;
}

/** An edit that cannot be made as asked. */
export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

export type Styles = Pick<Project, 'styles' | 'files'>;

/** The style with this name.  An unknown name stops. */
export function namedStyle({ styles }: Styles, name: string): ProjectStyle {
  const style = styles.find((candidate) => candidate.name === name);
  if (!style) throw new EditError(`The project has no style called "${name}".`);
  return style;
}

/** The style's index in the document, listing it there if the document has not used it yet. */
export function styleIndex(document: DocumentText, style: ProjectStyle): number {
  const index = document.styleIds.indexOf(style.id);
  if (index >= 0) return index;
  document.styleIds.push(style.id);
  return document.styleIds.length - 1;
}

/** The first text in these nodes, whose formatting is the text's. */
export const firstText = (nodes: readonly MarkupNode[]) =>
  nodes.find((node): node is Extract<MarkupNode, { kind: 'text' }> => node.kind === 'text');

/**
 * What a style's sample says a paragraph in it looks like: its paragraph format, its text's
 * formatting, and the tags Scrivener writes around that text.
 */
export function sampleOf({ format: sample }: ProjectStyle) {
  const paragraph = sample.paragraphs[0];
  const text = firstText(paragraph?.content ?? []);
  if (!paragraph || !text) return { format: {}, character: {}, before: [], after: [] };
  const at = paragraph.content.indexOf(text);
  return {
    format: paragraph.format,
    character: text.format,
    before: paragraph.content.slice(0, at),
    after: paragraph.content.slice(at + 1),
  };
}

/**
 * The look a style gives text that looks like `text`, as Scrivener applies a style.  A Paragraph
 * style changes no character attribute; a Character or Paragraph+Character style gives all of its
 * own.  Either way the font family and size come from the style only where its `FontChange` names
 * them, and stay the text's own otherwise.
 */
export function styledLook(style: ProjectStyle, text: CharacterFormat): CharacterFormat {
  const { font, size, ...character } = sampleOf(style).character;
  const changes = new Set(style.fontChange?.split('+'));
  const { font: textFont, size: textSize, ...own } = text;
  const face = changes.has('Face') ? font : textFont;
  const sized = changes.has('Size') ? size : textSize;
  return {
    ...(style.type === 'Para' ? own : character),
    ...(face === undefined ? {} : { font: face }),
    ...(sized === undefined ? {} : { size: sized }),
  };
}

/** Each kind of picture file RTF can hold, by its extension, and how RTF names it. */
const PICTURE_FILES: Record<string, { word: string; extension: string }> = {
  '.jpg': { word: 'jpegblip', extension: 'jpg' },
  '.jpeg': { word: 'jpegblip', extension: 'jpg' },
  '.png': { word: 'pngblip', extension: 'png' },
};

/** A picture's size in pixels. */
type Size = { width: number; height: number };

/** Twips to the pixel, as macOS writes a picture's size. */
const TWIPS = 20;

/** A picture file's own size in pixels, from its header. */
function fileSize(files: Files, file: string): Size {
  try {
    const { width, height } = imageSize(files.read(file));
    return { width, height };
  } catch {
    throw new EditError(`${file} has no size this can read.`);
  }
}

/**
 * A picture to embed, from its file, as macOS writes one: the file's own size in pixels, and the
 * size it shows at.
 */
function pictureFrom(files: Files, file: string, shown?: Size): Picture {
  const kind = PICTURE_FILES[path.extname(file).toLowerCase()];
  if (!kind) throw new EditError(`${file} is not a picture this can embed.`);
  const name = path.basename(file, path.extname(file));
  const own = fileSize(files, file);
  const { width, height } = shown ?? own;
  const size = `\\picw${own.width}\\pich${own.height}\\picwgoal${width * TWIPS}\\pichgoal${height * TWIPS}`;
  const hex = hexOf(files.read(file));
  const rtf = `{\\*\\shppict{\\pict {\\*\\nisusfilename ${name}}${size}\\${kind.word} ${hex}}}`;
  return { rtf, name, extension: kind.extension };
}

/** How a new annotation opens, in Scrivener's default colour. */
const ANNOTATION = String.raw`{\Scrv_annot \color={\R=1.0\G=0.0\B=0.0} \text=`;

/** One piece's text, as a link or note when it is one, in its formatting. */
export function pieceNodes(
  { text, link, bold, italic, note, size }: Inline,
  base: CharacterFormat,
  files: Files,
): MarkupNode[] {
  const format = { ...base, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) };
  if (link) {
    const linked = { ...format, field: linkField(link) };
    return [{ kind: 'link', target: link, content: [{ kind: 'text', text, format: linked }] }];
  }
  const written: MarkupNode = { kind: 'text', text, format };
  if (note === 'footnote' || note === 'preserved') {
    return [{ kind: note, content: [written], open: { format }, close: { format } }];
  }
  if (note === 'annotation') {
    const content: MarkupNode[] = [written];
    return [{ kind: note, opening: ANNOTATION, content, open: { format }, close: { format } }];
  }
  if (note === 'picture') {
    return [{ kind: 'picture', picture: pictureFrom(files, text, size), format }];
  }
  if (note === 'image') {
    const { width, height } = size ?? fileSize(files, text);
    const source = `{$SCRImageLink[w:${width};h:${height}]=${text}}`;
    return [{ kind: 'image', path: text, source, format }];
  }
  return [written];
}

/** The text's nodes: each character style's markers around its text, in the style's formatting. */
export function inlineNodes(
  project: Styles,
  document: DocumentText,
  text: string | Inline[],
  format: CharacterFormat,
): MarkupNode[] {
  const inlines = typeof text === 'string' ? [{ text }] : text;
  return inlines.flatMap((inline): MarkupNode[] => {
    const { style } = inline;
    if (style === undefined) return pieceNodes(inline, format, project.files);
    const named = namedStyle(project, style);
    const index = styleIndex(document, named);
    return [
      styleMarker('character', index, false, format),
      ...pieceNodes(inline, sampleOf(named).character, project.files),
      styleMarker('character', index, true, format),
    ];
  });
}

/**
 * The nearest paragraph to a place whose text starts in no style, whose look unstyled text takes.
 * A list item or table cell is none: a paragraph that took its look would be one too.
 */
export function plainNeighbour(document: DocumentText, at: number): Paragraph | undefined {
  const opens = opensAt(document);
  const plain = document.paragraphs
    .map((paragraph, index) => ({
      paragraph,
      index,
      open: openAtText(document, index, opens[index]),
    }))
    .filter(
      ({ paragraph, open }) =>
        open.paragraph === undefined &&
        open.character === undefined &&
        !paragraph.format.list &&
        !inTable(paragraph) &&
        firstText(paragraph.content),
    );
  plain.sort((a, b) => Math.abs(a.index - at) - Math.abs(b.index - at));
  return plain[0]?.paragraph;
}

/** The style a document's marker numbers, when the project has it. */
export function styleAt({ styles }: Styles, document: DocumentText, index: number | undefined) {
  const id = index === undefined ? undefined : document.styleIds[index];
  return styles.find((candidate) => candidate.id === id);
}

/** Whether a node is a piece of a paragraph: it has text, or is a note or image. */
export function isPiece(node: MarkupNode): boolean {
  return (
    markupText([node]) !== '' || isSpan(node) || node.kind === 'image' || node.kind === 'picture'
  );
}

/** A piece's text and what it is, apart from any character style. */
function pieceOf(node: MarkupNode, look: CharacterFormat): Inline {
  if (node.kind === 'image') return { text: node.path, note: 'image' };
  if (node.kind === 'picture') return { text: node.picture.name ?? '', note: 'picture' };
  if (isSpan(node)) return { text: markupText(node.content), note: node.kind };
  const text = markupText([node]);
  if (node.kind === 'link') return { text, link: node.target };
  const { format } = node;
  return {
    text,
    ...(format.bold && !look.bold ? { bold: true } : {}),
    ...(format.italic && !look.italic ? { italic: true } : {}),
  };
}

/** Each piece of a paragraph, with its character style. */
function inlinesOf(
  project: Styles,
  document: DocumentText,
  paragraph: number,
  placeholders: boolean,
  start: Open,
): Inline[] {
  let open = start;
  const inlines: Inline[] = [];
  for (const node of document.paragraphs[paragraph]!.content) {
    open = openAfter([node], open);
    if (!isPiece(node)) continue;
    const named = styleAt(project, document, open.paragraph);
    const style = styleAt(project, document, open.character)?.name;
    const read = pieceOf(node, named ? sampleOf(named).character : {});
    const held = placeholders && node.kind === 'placeholder';
    const piece: Inline = held ? { ...read, placeholder: true } : read;
    inlines.push(style === undefined ? piece : { ...piece, style });
  }
  return inlines;
}

/** Where a paragraph is in a document's tables: which table, row and cell, and which of the cell's. */
export interface TablePlace {
  table: number;
  row: number;
  column: number;
  part: number;
}

/**
 * A paragraph as it reads: where it is, its paragraph style, its HTML header level, which is the
 * text's own and not its style's, and its text.
 */
export interface ReadParagraph {
  paragraph: number;
  style?: string;
  level?: number;
  text: Inline[];
  list?: ListShape;
  cell?: TablePlace;
}

/** Whether a paragraph is in a table, by its format or by ending a cell. */
function inTable({ format, end }: Paragraph): boolean {
  return format.table?.inTable === true || (end.kind !== 'paragraph' && end.kind !== 'document');
}

/** Whether a place falls inside a table, where nothing can go or end. */
export function cutsTable({ paragraphs }: DocumentText, at: number): boolean {
  const before = paragraphs[at - 1];
  const after = paragraphs[at];
  return !!before && !!after && inTable(before) && inTable(after) && !before.end.lastRow;
}

/** Whether a note runs across a place between paragraphs, where nothing can go or end. */
export function cutsNote({ paragraphs }: DocumentText, at: number): boolean {
  return paragraphs[at - 1]?.content.some(runsOn) === true;
}

/** What to say of an edit that would cut a note that runs across paragraphs. */
export const NOTE_ACROSS = 'A note across paragraphs goes on through them: it must stay whole.';

/** Each paragraph's place in the document's tables; none for one outside them. */
function tablePlaces({ paragraphs }: DocumentText): (TablePlace | undefined)[] {
  let place: TablePlace = { table: 0, row: 0, column: 0, part: 0 };
  const nextTable = () => ({ table: place.table + 1, row: 0, column: 0, part: 0 });
  return paragraphs.map((paragraph) => {
    if (!inTable(paragraph)) {
      if (place.row > 0) place = nextTable();
      return undefined;
    }
    const here = place;
    const { kind, lastRow } = paragraph.end;
    if (kind === 'row') place = { ...place, row: place.row + 1, column: 0, part: 0 };
    else if (kind === 'cell') place = { ...place, column: place.column + 1, part: 0 };
    else place = { ...place, part: place.part + 1 };
    if (lastRow) place = nextTable();
    return here;
  });
}

/** A document's paragraphs, as typed data. */
export function readParagraphs(
  project: Styles,
  document: DocumentText,
  { placeholders = false } = {},
): ReadParagraph[] {
  const places = tablePlaces(document);
  const opens = opensAt(document);
  return document.paragraphs.map((_, at) =>
    readOne(project, document, at, places[at], placeholders, opens[at]!),
  );
}

/** One paragraph of a document, as `readParagraphs` reads it. */
export const readParagraph = (project: Styles, document: DocumentText, at: number) =>
  readOne(project, document, at, tablePlaces(document)[at], false, openAt(document, at));

function readOne(
  project: Styles,
  document: DocumentText,
  paragraph: number,
  cell: TablePlace | undefined,
  placeholders: boolean,
  open: Open,
): ReadParagraph {
  const atText = openAtText(document, paragraph, open);
  const style = styleAt(project, document, atText.paragraph)?.name;
  const text = inlinesOf(project, document, paragraph, placeholders, open);
  const list = listShape(document, document.paragraphs[paragraph]!);
  return {
    paragraph,
    ...(style === undefined ? {} : { style }),
    ...(atText.heading === undefined ? {} : { level: atText.heading }),
    text,
    ...(list ? { list } : {}),
    ...(cell ? { cell } : {}),
  };
}

/** The look of plain text in a paragraph: its style's, or the plain text nearest it. */
export function lookOf(project: Styles, document: DocumentText, paragraph: number) {
  const named = styleAt(project, document, openAtText(document, paragraph).paragraph);
  const plain = firstText(plainNeighbour(document, paragraph)?.content ?? [])?.format;
  return named ? styledLook(named, plain ?? {}) : plain;
}

/** The paragraph at an index.  None there stops. */
export function paragraphAt(document: DocumentText, paragraph: number): Paragraph {
  const target = document.paragraphs[paragraph];
  if (!target) throw new EditError(`The document has no paragraph ${paragraph}.`);
  return target;
}
