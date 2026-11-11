import * as path from 'pathe';
import type { CompileFormat } from './compile-format.ts';
import { commentText, type DocumentText } from './document.ts';
import { type Project, styleName } from './project.ts';
import type { ProjectStyle } from './project-styles.ts';
import { type GroupedCell, type RtfListItem } from './grouping.ts';
import { LINE_BREAK, type ParagraphFormat } from './rich-text.ts';
import {
  type PlaceholderPart,
  placeholderText,
  readPlaceholders,
  startsPlaceholder,
} from './placeholder-syntax.ts';
import type { LinkTarget } from './link-target.ts';
import { isSpan, type MarkupNode, type StyleMarker, writtenText } from './markup.ts';
import type { Picture } from './rich-text.ts';
import { UnsupportedError } from './unsupported.ts';

/** The project's compile options that change a paragraph's markup. */
export interface MarkupOptions {
  convertLinks: boolean;
  removeAnnotations: boolean;
  removeComments: boolean;
  removeFootnotes: boolean;
  deleteStruckThrough: boolean;
  /** Convert rich text to MultiMarkdown, when it is on. */
  richText?: RichTextOptions;
}

/** How rich text converts to MultiMarkdown: `escape`, Markdown's punctuation in the text. */
export interface RichTextOptions {
  escape: boolean;
}

/** The direct formatting of the document's own text, which converting rich text writes. */
export interface DirectLook {
  bold: boolean;
  italic: boolean;
}

/** What resolving markup reads from the compile. */
export interface MarkupInput {
  project: Pick<Project, 'dir' | 'files'> & { styles: Pick<ProjectStyle, 'id' | 'name'>[] };
  format: Pick<CompileFormat, 'annotationPrefix' | 'annotationSuffix' | 'commentFormat'>;
  settings: { text: MarkupOptions };
  /** The images the text refers to, by name. */
  images?: Map<string, CompiledImage>;
}

/** The paragraphs of the documents markup includes. */
export interface Includes {
  /** The document a link includes, by binder ID. */
  byId: (id: string) => ResolvedParagraph[];
  /** The document `<$include:title>` names, if one has that title. */
  byTitle: (title: string) => ResolvedParagraph[] | undefined;
}

/** A style marker with the name of the style it numbers; empty when the document lists none. */
export interface ResolvedStyle extends Omit<StyleMarker, 'index'> {
  name: string;
}

/** An image a compile refers to: how it defines it, and the file that goes beside the text. */
export interface CompiledImage {
  definition: string;
  file: string;
  /** Where an embedded picture's bytes are. */
  picture?: Picture;
  /** Where a linked image is. */
  from?: string;
}

/** Keeps an image by its name.  Two that differ under one name stop: only one could be defined. */
export function defineImage(
  images: Map<string, CompiledImage> | undefined,
  name: string,
  image: CompiledImage,
): void {
  const known = images?.get(name);
  if (known && (known.picture?.rtf !== image.picture?.rtf || known.from !== image.from)) {
    throw new UnsupportedError(`two different images named ${name}`);
  }
  images?.set(name, image);
}

/** A linked image's size, in its link. */
const IMAGE_SIZE = /\[w:(?<width>[\d.]+);h:(?<height>[\d.]+)\]/;

/** What Scrivener writes for an image linked to a file that is not there. */
export const MISSING_IMAGE = 'MISSING_IMAGE:';

/** The file a linked image's path names: a relative path is from the folder the project is in. */
export const linkedImageFile = ({ dir }: Pick<Project, 'dir'>, linked: string) =>
  path.resolve(path.dirname(dir), linked);

/**
 * A paragraph's markup resolved for the compile: text, style markers, kept footnotes, and the
 * paragraphs of an included document.
 */
export type ResolvedNode =
  | TextNode
  | ResolvedStyle
  | { kind: 'footnote'; content: ResolvedNode[] }
  | { kind: 'include'; paragraphs: ResolvedParagraph[] }
  /** An included document's text, set in place; its styles do not reach the text around it. */
  | { kind: 'included'; content: ResolvedNode[] }
  /** Placeholder text that describes another binder item: a document link's whole text. */
  | { kind: 'bound'; text: string; item: string }
  /** One end of a document link written as MultiMarkdown. */
  | LinkEdgeNode;

export interface LinkEdgeNode {
  kind: 'edge';
  text: string;
  link: string;
  edge: 'open' | 'close';
}

/** A paragraph resolved for the compile, as a list item or a table row when it is one. */
export interface ResolvedParagraph {
  nodes: ResolvedNode[];
  list?: RtfListItem;
  row?: ResolvedCell[];
  /** Which of its document's paragraphs it is, when it is one and only one. */
  source?: number;
  /** The spacing it has before and after, in twips. */
  spacing?: Pick<ParagraphFormat, 'spaceBefore' | 'spaceAfter'>;
}

export type ResolvedCell = GroupedCell<ResolvedNode[]>;

interface TextNode {
  kind: 'text';
  text: string;
  /** The compile wrote it, as a link's address: it is no text of the document's. */
  written?: true;
  /** Typed text, as converting rich text to MultiMarkdown converts it, when that is on. */
  look?: DirectLook;
}

/** Paragraphs inside a footnote: a new line, indented to continue the note. */
const FOOTNOTE_PARAGRAPH = '\n\t';

/** A line break inside a list item continues the item in a paragraph of its own. */
const LIST_ITEM_BREAK = '\n\n\t';

/**
 * Resolves links, linked comments, footnotes and annotations as the compile options say, leaving
 * text and style markers.  A line break stays a line separator, except in a list item, where a
 * run of them starts one new paragraph.
 */
export function resolveMarkup(
  nodes: MarkupNode[],
  { comments, styleIds }: Pick<DocumentText, 'comments' | 'styleIds'>,
  { project, format, settings, images }: MarkupInput,
  includes: Includes,
  listItem = false,
): ResolvedNode[] {
  const options = settings.text;
  const resolve = (node: MarkupNode, index = 0, siblings: MarkupNode[] = []): ResolvedNode[] => {
    if (node.kind === 'text') {
      if (!options.richText) return [text(node.text)];
      const { bold, italic } = node.format;
      return [{ ...text(node.text), look: { bold: bold === true, italic: italic === true } }];
    }
    // How Scrivener compiles one is unknown until a sample shows it.
    if (isSpan(node) && !(node.open && node.close)) {
      throw new UnsupportedError('a footnote, annotation or Preserve Formatting across paragraphs');
    }
    if (node.kind === 'placeholder') {
      const title = includedTitle(node);
      const paragraphs = title === undefined ? undefined : includes.byTitle(title);
      return paragraphs ? [{ kind: 'include', paragraphs }] : [text(placeholderText(node))];
    }
    if (node.kind === 'style') {
      const { index: listed, ...marker } = node;
      return [{ ...marker, name: styleName(project, styleIds[listed]) }];
    }
    if (node.kind === 'break') {
      if (!listItem) return [text(LINE_BREAK)];
      return siblings[index - 1]?.kind === 'break' ? [] : [text(LIST_ITEM_BREAK)];
    }
    if (node.kind === 'footnote') {
      if (options.removeFootnotes) return [];
      return [
        {
          kind: 'footnote',
          content: inlineIncludes(node.content.flatMap(resolve), 'a footnote', FOOTNOTE_PARAGRAPH),
        },
      ];
    }
    if (node.kind === 'picture') {
      const { name, extension } = node.picture;
      if (name === undefined || extension === undefined) {
        throw new UnsupportedError('an embedded picture with no file name');
      }
      const file = `${name}.${extension}`;
      defineImage(images, name, { definition: file, file, picture: node.picture });
      return [written(`![][${name}]`)];
    }
    if (node.kind === 'image') {
      const from = linkedImageFile(project, node.path);
      if (!project.files.exists(from)) return [written(`${MISSING_IMAGE}${node.path}`)];
      const file = path.basename(node.path);
      const name = path.basename(file, path.extname(file));
      const size = IMAGE_SIZE.exec(node.source)?.groups;
      const writtenSize = size ? ` width=${size.width}px height=${size.height}px` : '';
      defineImage(images, name, { definition: `${file}${writtenSize}`, file, from });
      return [written(`![][${name}]`)];
    }
    if (node.kind === 'annotation') {
      if (options.removeAnnotations) return [];
      return [written(format.annotationPrefix + flatText(node.content) + format.annotationSuffix)];
    }
    // Heading and keep-with-next markers write nothing; Preserve Formatting writes its text.
    if (node.kind === 'tag') return [];
    if (node.kind === 'preserved') return node.content.flatMap(resolve);
    if (node.target.kind === 'document' && startsWithPlaceholder(node.content)) {
      const { id } = node.target;
      if (isWholeInclude(node.content)) return [{ kind: 'include', paragraphs: includes.byId(id) }];
      // A document link on placeholders makes them describe the linked document (the link may
      // stop short of a placeholder's end), and the link itself is not written.
      const bound: ResolvedNode[] = [];
      for (const child of node.content) {
        const written = writtenText(child);
        const last = bound.at(-1);
        if (written === undefined) bound.push(...resolve(child));
        else if (last?.kind === 'bound') last.text += written;
        else bound.push({ kind: 'bound', text: written, item: id });
      }
      return bound;
    }
    return linkNodes(node.target, node.content.flatMap(resolve));
  };
  /** Annotations keep their markup as typed. */
  const flatText = (content: MarkupNode[]) =>
    content
      .flatMap(resolve)
      .map((node) => {
        if (node.kind === 'text' || node.kind === 'bound' || node.kind === 'edge') return node.text;
        // Markup in an annotation stays as typed, so only an included document gets here.
        throw new UnsupportedError('an annotation with an included document');
      })
      .join('');
  const linkNodes = (target: LinkTarget, linkText: ResolvedNode[]): ResolvedNode[] => {
    if (target.kind === 'comment') {
      if (options.removeComments) return linkText;
      // The format's comment template: <$lnk> is the linked text, <$cmt> the comment.
      const linked = comments.find((comment) => comment.id === target.id);
      const comment = linked ? commentText(linked) : '';
      return readPlaceholders(format.commentFormat).flatMap((part): ResolvedNode[] => {
        if (part.kind === 'text') return [written(part.text)];
        if (part.slashes === 0 && part.name === 'lnk') return linkText;
        if (part.slashes === 0 && part.name === 'cmt') return [written(comment)];
        return [written(placeholderText(part))];
      });
    }
    if (!options.convertLinks) return linkText;
    if (target.kind === 'document') {
      const { id } = target;
      // The reference is the compile's to write, once every heading is final.
      const close = '][]';
      return [
        { kind: 'edge', text: '[', link: id, edge: 'open' },
        ...linkText,
        { kind: 'edge', text: close, link: id, edge: 'close' },
      ];
    }
    return [written('['), ...linkText, written(`](${target.address})`)];
  };
  return nodes.flatMap((node, index) => resolve(node, index, nodes));
}

const text = (value: string): TextNode => ({ kind: 'text', text: value });
const written = (value: string): TextNode => ({ ...text(value), written: true });

/** The title `<$include:title>` names, when the placeholder is that and its title plain text. */
function includedTitle(placeholder: PlaceholderPart): string | undefined {
  if (placeholder.kind === 'text' || placeholder.name !== 'include') return undefined;
  if (placeholder.separator !== ':' || placeholder.slashes !== 0) return undefined;
  const words = placeholder.argument.filter((part) => part.kind === 'text');
  if (words.length !== placeholder.argument.length) return undefined;
  return words.map((part) => part.text).join('');
}

/**
 * Whether a link's text, style markers aside, starts with a placeholder, or with what starts one
 * (a link may stop short of a placeholder's end).
 */
function startsWithPlaceholder(content: MarkupNode[]): boolean {
  const first = content.find((node) => node.kind !== 'style');
  return first?.kind === 'placeholder' || (first?.kind === 'text' && startsPlaceholder(first.text));
}

/** Whether a link's text, style markers aside, is `<$include>` and nothing else. */
function isWholeInclude(content: MarkupNode[]): boolean {
  const [only, ...others] = content.filter((node) => node.kind !== 'style');
  return (
    others.length === 0 &&
    only?.kind === 'placeholder' &&
    only.name === 'include' &&
    only.separator === undefined &&
    only.slashes === 0
  );
}

/**
 * Where there are no paragraphs to split (a footnote, a table cell), a document included there
 * must be one paragraph, whose text goes in place of the link.
 */
export function inlineIncludes(
  nodes: ResolvedNode[],
  where: string,
  paragraphBreak?: string,
): ResolvedNode[] {
  return nodes.flatMap((node) => {
    if (node.kind !== 'include') return [node];
    const paragraphs = [...node.paragraphs];
    while (paragraphs.length > 1 && paragraphs.at(-1)!.nodes.length === 0) paragraphs.pop();
    const several = paragraphs.length > 1 && paragraphBreak === undefined;
    if (several || paragraphs.some((paragraph) => paragraph.row)) {
      throw new UnsupportedError(`${where} that includes more than one paragraph`);
    }
    const content = paragraphs.flatMap((paragraph, index) => [
      ...(index > 0 ? [text(paragraphBreak!)] : []),
      ...paragraph.nodes,
    ]);
    return [{ kind: 'included', content }];
  });
}
