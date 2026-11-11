/** `Files/search.indexes` and `Files/Data/docs.checksum`: what Scrivener keeps about each document. */
import { sha1 } from '@noble/hashes/legacy';
import { hexOf } from './files.ts';
import type { DocumentText } from './document.ts';
import { textWithImages } from './markup.ts';
import type { Project } from './project.ts';
import { linkedImageFile, MISSING_IMAGE } from './resolve-markup.ts';
import { attribute, element, list, optionalTextChild, string } from './xml-codec.ts';

/** A document's entry in the search index. */
export interface SearchEntry {
  id: string;
  title?: string;
  synopsis?: string;
  text?: string;
  notes?: string;
  comments?: string;
}

const entry = element<SearchEntry>('Document', {
  id: attribute('ID', string),
  title: optionalTextChild('Title', string),
  synopsis: optionalTextChild('Synopsis', string),
  text: optionalTextChild('Text', string),
  notes: optionalTextChild('Notes', string),
  comments: optionalTextChild('Comments', string),
});

/** The `Files/search.indexes` file. */
export const searchIndexFile = element('SearchIndexes', {
  version: attribute('Version', string),
  documents: list('Documents', entry),
});

/**
 * A document's text as the index holds it: each paragraph on a line, a list item with its marker,
 * and a linked image whose file is not there as the compile writes it.
 */
export function indexedText(
  { paragraphs }: Pick<DocumentText, 'paragraphs'>,
  project: Pick<Project, 'dir' | 'files'>,
): string {
  const image = (linked: string) =>
    project.files.exists(linkedImageFile(project, linked)) ? '' : `${MISSING_IMAGE}${linked}`;
  return paragraphs
    .map(({ content, marker }) => {
      const before = marker?.map(({ text }) => text).join('') ?? '';
      return `${before}${textWithImages(content, image)}`;
    })
    .join('\n');
}

/** Each file's checksum, by `<lowercase id>/<file>`, in the file's order. */
export type Checksums = Map<string, string>;

/** The `Files/Data/docs.checksum` file's lines, each `<id>/<file>=<sha1>`. */
export function readChecksums(source: string): Checksums {
  const entries = source
    .split('\n')
    .filter((line) => line !== '')
    .map((line): [string, string] => {
      const at = line.lastIndexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    });
  return new Map(entries);
}

/** Checksums as their file, with no newline at the end. */
export function writeChecksums(checksums: Checksums): string {
  return [...checksums].map(([file, sum]) => `${file}=${sum}`).join('\n');
}

/** The key a document's file has among the checksums. */
export const checksumKey = (id: string, file: string) => `${id.toLowerCase()}/${file}`;

/** A file's checksum, of its bytes. */
export const checksumOf = (bytes: Uint8Array) => hexOf(sha1(bytes));
