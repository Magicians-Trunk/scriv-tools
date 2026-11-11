/** An item's documents: its text and notes, as rich text read into markup, and its synopsis. */
import { localFiles } from './local-files.ts';
import { type Files, latin1Text, readText } from './files.ts';
import * as path from 'pathe';
import { groupParagraphs } from './grouping.ts';
import { type MarkupNode, markupRuns, markupText, parseParagraphs } from './markup.ts';
import { type RichDocument } from './rich-text.ts';
import { readRichText } from './rich-text-reader.ts';
import { rewriteRichText } from './rich-text-rewrite.ts';
import { escapeText } from './rtf-text.ts';
import {
  attribute,
  type Codec,
  color,
  element,
  repeated,
  string,
  text,
  newUnread,
  optionalAttribute,
  type Unread,
  type Value,
  writeXml,
  yesNo,
} from './xml-codec.ts';
import { refuseUnknown } from './unsupported.ts';
import { readXml } from './xml.ts';

/**
 * A document's text, or notes: its rich text, each paragraph's runs read into markup; the style
 * IDs its style markers number, from its `.styles` file; its linked comments, from its
 * `.comments` file; and the RTF it was read from, `''` for an item with no such file.
 * `documentRichText` gives back the rich text it was read from.
 */
export interface DocumentText extends RichDocument<MarkupNode[]> {
  styleIds: string[];
  comments: Comment[];
  source: string;
  /** The version its comments file names; current Scrivener names none. */
  commentsVersion?: string;
  /** What its comments file holds that the library does not know, so cannot write back. */
  unsupported: Unread;
}

/** A comment linked to a range of a document's text. */
export interface Comment {
  id: string;
  /** Older Scrivener writes this; current Scrivener leaves it out. */
  collapsed?: boolean;
  /** A linked footnote, not a comment. */
  footnote?: boolean;
  /** Red, green and blue, each from 0 to 1. */
  color: number[];
  text: DocumentText;
}

/** Lines of plain text as a document: RTF, as Scrivener stores a layout's prefix or a style. */
export function plainDocument(written: string): DocumentText {
  const lines = written.split('\n').map((line) => escapeText(line));
  return readDocumentText(`{\\rtf1\\ansi\\ansicpg1252\\uc0\n${lines.join('\\\n')}}`);
}

/** RTF held in an XML element, read as a document and written back over the RTF it was read from. */
export const rtfText: Value<DocumentText> = {
  read: (raw) => readDocumentText(raw),
  write: documentRtf,
};

const comment = element<Comment>('Comment', {
  id: attribute('ID', string),
  footnote: optionalAttribute('Footnote', yesNo),
  collapsed: optionalAttribute('Collapsed', yesNo),
  color: attribute('Color', color),
  text: text(rtfText, true),
});

/** A `.comments` file. */
const commentsFile: Codec<{ version: string | undefined; comments: Comment[] }> = element(
  'Comments',
  {
    version: optionalAttribute('Version', string),
    comments: repeated(comment),
  },
);

/**
 * A document's comments as their `.comments` file, in the form it was read: an older one names a
 * version and ends with a newline.  Refuses comments read with anything the library does not know.
 */
export function writeComments({
  comments,
  commentsVersion,
  unsupported,
}: Pick<DocumentText, 'comments' | 'commentsVersion' | 'unsupported'>): string {
  refuseUnknown('the comments file', unsupported);
  const older = commentsVersion !== undefined;
  return writeXml(commentsFile.write({ version: commentsVersion, comments }), older);
}

/** A document's lines, as the compile reads them: its paragraphs, with table rows grouped. */
export function documentLines(document: DocumentText): MarkupNode[][] {
  return groupParagraphs(document, []).map((paragraph) => paragraph.content);
}

/** A comment's text as the compile writes it: its paragraphs' text, a line each. */
export function commentText({ text: document }: Comment): string {
  return documentLines(document).map(markupText).join('\n');
}

/** Which of an item's documents: its text, or its notes. */
export type DocumentPart = 'content' | 'notes';

/**
 * Where a compile, or anything else, gets an item's documents: read from the project's files, or
 * held in memory, as an editor holds the ones it changed.
 */
export interface Documents {
  /** The item's text or notes; an item with no such file has no paragraphs. */
  text: (id: string, part?: DocumentPart) => DocumentText;
  /** The item's synopsis, as written in its `synopsis.txt`; empty when it has none. */
  synopsis: (id: string) => string;
}

/** A document read from its RTF, with the style IDs its markers number and its comments. */
export function readDocumentText(
  source: string,
  styleIds: string[] = [],
  comments: Comment[] = [],
  unsupported: Unread = newUnread(),
): DocumentText {
  const { paragraphs, ...rich } = readRichText(source);
  const markup = parseParagraphs(paragraphs.map(({ content }) => content));
  return {
    ...rich,
    paragraphs: paragraphs.map((paragraph, index) => ({ ...paragraph, content: markup[index]! })),
    styleIds,
    comments,
    source,
    unsupported,
  };
}

/** A document as rich text again: its markup written back into runs. */
export function documentRichText(document: DocumentText): RichDocument {
  const { settings, fonts, colors, lists, listOverrides } = document;
  return {
    settings,
    fonts,
    colors,
    lists,
    listOverrides,
    paragraphs: document.paragraphs.map((paragraph) => ({
      ...paragraph,
      content: markupRuns(paragraph.content),
    })),
  };
}

/** A document's RTF, as saving writes it: its source kept wherever that still reads the same. */
export function documentRtf(document: DocumentText): string {
  return rewriteRichText(document.source, documentRichText(document));
}

/** A document as its file reads once saved, so what it holds is what the file says. */
export const readAgain = (document: DocumentText): DocumentText =>
  readDocumentText(documentRtf(document), document.styleIds, document.comments);

/** The documents in a project's folder, read from their files each time they are asked for. */
export function projectDocuments(dir: string, files: Files = localFiles): Documents {
  const folder = (id: string) => path.join(dir, 'Files', 'Data', id);
  return {
    text: (id, part = 'content') => readDocumentFile(files, folder(id), part),
    synopsis: (id) => {
      const file = path.join(folder(id), 'synopsis.txt');
      return files.exists(file) ? readText(files, file) : '';
    },
  };
}

/** The files a document is read from, by their extension. */
const DOCUMENT_FILES = ['rtf', 'styles', 'comments'];

/** A document as it was read, and the bytes of each of its files then. */
interface KeptDocument {
  bytes: (Uint8Array | undefined)[];
  text: DocumentText;
}

/**
 * The documents in a project's folder, each read once and kept for as long as its files hold the
 * same bytes, as files held in memory do until they are written.  What it gives is shared: an
 * edit changes a document where it stands, so it reads its own from `projectDocuments`.
 */
export function keptDocuments(dir: string, files: Files): Documents {
  const reading = projectDocuments(dir, files);
  const kept = new Map<string, KeptDocument>();
  return {
    text(id, part = 'content') {
      const bytes = DOCUMENT_FILES.map((extension) => {
        const file = path.join(dir, 'Files', 'Data', id, `${part}.${extension}`);
        return files.exists(file) ? files.read(file) : undefined;
      });
      const place = path.join(id, part);
      const held = kept.get(place);
      if (held?.bytes.every((each, at) => each === bytes[at])) return held.text;
      const read = reading.text(id, part);
      kept.set(place, { bytes, text: read });
      return read;
    },
    synopsis: reading.synopsis,
  };
}

function readDocumentFile(files: Files, folder: string, part: DocumentPart): DocumentText {
  const read = (extension: string) => {
    const file = path.join(folder, `${part}.${extension}`);
    return files.exists(file) ? latin1Text(files.read(file)) : undefined;
  };
  const styles = read('styles');
  const commentsPath = path.join(folder, `${part}.comments`);
  const found = newUnread();
  const file = files.exists(commentsPath)
    ? commentsFile.read(readXml(commentsPath, 'Comments', files), found)
    : undefined;
  const document = readDocumentText(
    read('rtf') ?? '',
    styles === undefined ? [] : styles.trim().split(','),
    file?.comments ?? [],
    found,
  );
  return file?.version === undefined ? document : { ...document, commentsVersion: file.version };
}
