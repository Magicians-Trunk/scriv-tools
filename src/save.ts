/**
 * Saving a project: every file whose model changed, written as Scrivener writes it, and nothing
 * else.  Scrivener's own records of a changed document, the search index and the checksums, are
 * kept up with it; those of any other document stay as they are, stale or not.
 */
import { type Files, latin1Bytes, latin1Text, newId, readText, textBytes } from './files.ts';
import * as path from 'pathe';
import { type FoundFormat, writeFormat } from './compile-format.ts';
import { compileXml, writeCompileXml } from './compile-xml.ts';
import { dateStamp } from './dates.ts';
import { type DocumentText, documentRtf, writeComments } from './document.ts';
import { keepsText } from './binder-item.ts';
import { findItem, indexBinder, type Project } from './project.ts';
import { stylesFile, writeStyles } from './project-styles.ts';
import { scrformat } from './scrformat.ts';
import { scrivxFile, writeScrivx } from './scrivx.ts';
import {
  checksumKey,
  checksumOf,
  indexedText,
  readChecksums,
  type SearchEntry,
  searchIndexFile,
  writeChecksums,
} from './search-index.ts';
import { refuseUnknown, UnsupportedError } from './unsupported.ts';
import { type Codec, newUnread, writeXml } from './xml-codec.ts';
import { readXml } from './xml.ts';

/** An item's documents as they are to be saved; a part left out stays as it is on disk. */
export interface ItemDocumentsChange {
  content?: DocumentText;
  notes?: DocumentText;
  synopsis?: string;
}

/** What to save besides the project itself: changed documents by binder ID, and formats. */
export interface ProjectChanges {
  documents?: Map<string, ItemDocumentsChange>;
  /** The project's own compile formats, each saved to the file it was read from. */
  formats?: FoundFormat[];
  /** Formats to delete from the project, with their files. */
  removedFormats?: FoundFormat[];
  /** When the changes were made, which the changed items and the project are stamped with. */
  now?: Date;
}

/** What to say of a project Scrivener may have open. */
export const OPEN_IN_SCRIVENER =
  'Scrivener may have the project open, and could save over these changes.';

/** Whether Scrivener may have the project open: it leaves a lock while it does. */
export const scrivenerMayHaveIt = ({ dir, files }: Pick<Project, 'dir' | 'files'>) =>
  files.exists(path.join(dir, 'Files', 'user.lock'));

/** What a save did: the files it wrote or removed, and what the caller should know. */
export interface SaveResult {
  written: string[];
  removed: string[];
  warnings: string[];
}

/** A file's new content, or `undefined` to remove it. */
type FileContent = string | undefined;

/** A file to save: its new content, and what it holds now, in the same form. */
interface SavedFile {
  content: FileContent;
  current: FileContent;
}

/** RTF is written in Latin-1, its other characters escaped; everything else is UTF-8. */
const isLatin1 = (file: string) => path.extname(file) === '.rtf';

/** A file's content as the bytes it is written as. */
const bytesOf = (file: string, content: string) =>
  isLatin1(file) ? latin1Bytes(content) : textBytes(content);

/** The file's content as it is on disk, `undefined` when there is no such file. */
function onDisk(files: Files, file: string): FileContent {
  if (!files.exists(file)) return undefined;
  return isLatin1(file) ? latin1Text(files.read(file)) : readText(files, file);
}

/**
 * An XML file as its model would be written, so that it is saved only when its model changed: a
 * file that an older Scrivener wrote differently is left as it is until something in it changes.
 */
function asWritten<T>(files: Files, file: string, codec: Codec<T>): FileContent {
  if (!files.exists(file)) return undefined;
  return writeXml(codec.write(codec.read(readXml(file, codec.name, files), newUnread())));
}

/** A document's files: its RTF, its style IDs, and its comments, each gone when it has none. */
function documentFiles(folder: string, part: string, document: DocumentText) {
  const file = (extension: string) => path.join(folder, `${part}.${extension}`);
  const rtf = documentRtf(document);
  const styles = document.styleIds.length > 0 ? document.styleIds.join(',') : undefined;
  const comments = document.comments.length > 0 ? writeComments(document) : undefined;
  return new Map<string, FileContent>([
    [file('rtf'), rtf === '' ? undefined : rtf],
    [file('styles'), styles],
    [file('comments'), comments],
  ]);
}

/** The files of a document the checksums cover. */
const SUMMED = ['content.rtf', 'notes.rtf', 'synopsis.txt'];

/** The checksums with the changed documents' files as they will be. */
function addChecksums(
  project: Project,
  documents: Map<string, ItemDocumentsChange>,
  files: Map<string, SavedFile>,
): void {
  const file = path.join(project.dir, 'Files', 'Data', 'docs.checksum');
  const current = onDisk(project.files, file);
  if (current === undefined) return;
  const sums = readChecksums(current);
  for (const id of documents.keys()) {
    for (const name of SUMMED) {
      const saved = files.get(path.join(project.dir, 'Files', 'Data', id, name));
      if (!saved) continue;
      const key = checksumKey(id, name);
      if (saved.content === undefined) sums.delete(key);
      else sums.set(key, checksumOf(bytesOf(name, saved.content)));
    }
  }
  files.set(file, { content: writeChecksums(sums), current });
}

/** An item's index entry with what changed in it. */
function indexEntry(
  id: string,
  title: string | undefined,
  { content, notes, synopsis }: ItemDocumentsChange,
  entry: SearchEntry | undefined,
  project: Pick<Project, 'dir' | 'files'>,
): SearchEntry {
  const text = content ? indexedText(content, project) : entry?.text;
  const notesText = notes ? indexedText(notes, project) : entry?.notes;
  const held = synopsis ?? entry?.synopsis;
  return {
    id,
    ...(title === undefined ? {} : { title }),
    ...(held ? { synopsis: held } : {}),
    ...(text ? { text } : {}),
    ...(notesText ? { notes: notesText } : {}),
    ...(entry?.comments === undefined ? {} : { comments: entry.comments }),
  };
}

/** The search index with the changed documents as they will be. */
function addSearchIndex(
  project: Project,
  documents: Map<string, ItemDocumentsChange>,
  files: Map<string, SavedFile>,
): void {
  const file = path.join(project.dir, 'Files', 'search.indexes');
  if (!project.files.exists(file)) return;
  const index = searchIndexFile.read(
    readXml(file, searchIndexFile.name, project.files),
    newUnread(),
  );
  // The index as its model is written, as `asWritten` gives it, before the changes go in.
  const current = writeXml(searchIndexFile.write(index));
  const binder = indexBinder(project.binder);
  for (const [id, change] of documents) {
    const at = index.documents.findIndex((each) => each.id === id);
    const title = findItem(binder, id).title;
    const entry = indexEntry(id, title, change, index.documents[at], project);
    if (at < 0) index.documents.push(entry);
    else index.documents[at] = entry;
  }
  files.set(file, { content: writeXml(searchIndexFile.write(index)), current });
}

/** Scrivener's own records of the changed documents. */
function addRecords(
  project: Project,
  documents: Map<string, ItemDocumentsChange>,
  files: Map<string, SavedFile>,
): void {
  if (documents.size === 0) return;
  addChecksums(project, documents, files);
  addSearchIndex(project, documents, files);
}

/**
 * Saves the project: its `.scrivx`, styles and compile settings where the models no longer match
 * the files, the documents and formats given, and nothing else.  An item whose documents changed,
 * and the project when anything did, are stamped as Scrivener stamps them.  Every file is made
 * before any is written, so a file the library cannot write back stops the save with nothing
 * written.  Scrivener keeps an open project in memory and could save over the changes: a
 * `user.lock` in the project is warned of, and the save goes ahead.
 */
export function saveProject(project: Project, changes: ProjectChanges = {}): SaveResult {
  const now = changes.now ?? new Date();
  const files = new Map<string, SavedFile>();
  const index = indexBinder(project.binder);
  // Scrivener's records take only the parts that change a file, and keep what it wrote of the rest.
  const recorded = new Map<string, ItemDocumentsChange>();
  for (const [id, change] of changes.documents ?? []) {
    const item = findItem(index, id);
    const folder = path.join(project.dir, 'Files', 'Data', id);
    const parts = new Map<keyof ItemDocumentsChange, Map<string, FileContent>>();
    for (const part of ['content', 'notes'] as const) {
      const document = change[part];
      if (document) parts.set(part, documentFiles(folder, part, document));
    }
    if (change.synopsis !== undefined) {
      parts.set(
        'synopsis',
        new Map([[path.join(folder, 'synopsis.txt'), change.synopsis || undefined]]),
      );
    }
    const current = new Map(
      [...parts.values()].flatMap((part) =>
        [...part.keys()].map((file) => [file, onDisk(project.files, file)]),
      ),
    );
    const differs = ([file, content]: [string, FileContent]) => current.get(file) !== content;
    const changed = [...parts.values()].flatMap((part) => [...part].filter(differs));
    if (changed.length > 0) item.modified = dateStamp(now);
    for (const [file, content] of changed) files.set(file, { content, current: current.get(file) });
    const touches = (part: keyof ItemDocumentsChange) => [...parts.get(part)!].some(differs);
    if (change.content && !keepsText(item.type) && touches('content')) {
      throw new UnsupportedError(`text in a ${item.type} item, which keeps a file of its own`);
    }
    recorded.set(id, {
      ...(change.content && touches('content') ? { content: change.content } : {}),
      ...(change.notes && touches('notes') ? { notes: change.notes } : {}),
      ...(change.synopsis !== undefined && touches('synopsis')
        ? { synopsis: change.synopsis }
        : {}),
    });
  }
  addRecords(project, recorded, files);
  for (const format of changes.formats ?? []) {
    const current = asWritten(project.files, format.file, scrformat);
    files.set(format.file, { content: writeFormat(format), current });
  }
  for (const { file } of changes.removedFormats ?? []) {
    files.set(file, { content: undefined, current: asWritten(project.files, file, scrformat) });
  }
  const styles = path.join(project.dir, 'Files', 'styles.xml');
  const stylesNow = asWritten(project.files, styles, stylesFile);
  // A project with no styles file, and no styles, is left without one.
  const noStyles = stylesNow === undefined && project.styles.length === 0;
  files.set(styles, { content: noStyles ? undefined : writeStyles(project), current: stylesNow });
  if (project.compileSettings) {
    const settings = path.join(project.dir, 'Settings', 'compile.xml');
    const content = writeCompileXml(project.compileSettings, project.unsupported);
    files.set(settings, { content, current: asWritten(project.files, settings, compileXml) });
  }
  refuseUnknown('the project file', project.unsupported.scrivx);
  const changed = [...files].filter(([, { content, current }]) => content !== current);
  if (
    changed.length > 0 ||
    asWritten(project.files, project.file, scrivxFile) !== writeScrivx(project)
  ) {
    project.modified = dateStamp(now);
    project.modId = newId();
    changed.push([project.file, { content: writeScrivx(project), current: undefined }]);
  }
  const result: SaveResult = { written: [], removed: [], warnings: [] };
  if (scrivenerMayHaveIt(project)) result.warnings.push(OPEN_IN_SCRIVENER);
  for (const [file, { content }] of changed) {
    if (content === undefined) {
      project.files.remove(file);
      result.removed.push(file);
    } else {
      project.files.write(file, bytesOf(file, content));
      result.written.push(file);
    }
  }
  return result;
}
