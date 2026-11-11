/**
 * Comparing two versions of a project, as data: its binder, every document's text and notes, and
 * all that changes what it compiles to.  What only records a save or a window never shows: stamps,
 * the checksums, the search index, and selections.
 */
import {
  binderPlaces,
  compareBinders,
  type BinderChange,
  type ProjectVersion,
} from './binder-compare.ts';
import { type FoundFormat, listFormats } from './compile-format.ts';
import { compareDocument, documentFaces, type DocumentComparison } from './document-compare.ts';
import { type DocumentPart, readDocumentText } from './document.ts';
import type { Styles } from './edit-pieces.ts';
import type { Project } from './project.ts';
import type { ProjectStyle } from './project-styles.ts';
import { same } from './rich-text.ts';
import type { Scrivx } from './scrivx.ts';
import { type ValueChange, valueChanges } from './value-compare.ts';

/** What the `.scrivx` file holds besides the binder that a reader of the project can see. */
export const PROJECT_SETTINGS = [
  'collections',
  'keywords',
  'sectionTypes',
  'labelSettings',
  'statusSettings',
  'customFields',
  'projectBookmarks',
  'templateFolderId',
  'bookmarksFolderId',
  'autoComplete',
  'printSettings',
  'externalSyncMap',
] as const satisfies readonly (keyof Scrivx)[];

/** The project's settings as a value. */
export function projectSettings(project: Project) {
  return Object.fromEntries(PROJECT_SETTINGS.map((key) => [key, project[key]]));
}

/** A style as a reader sees it, whatever its sample's RTF says otherwise. */
export function styleFace(project: Styles, { format, ...style }: ProjectStyle) {
  return { ...style, sample: documentFaces(project, format).map(({ whole }) => whole) };
}

/** What became of a style: its name, and what changed in it. */
export interface StyleChange {
  id: string;
  name: string;
  kind: 'added' | 'removed' | 'changed';
  changes: ValueChange[];
}

/** What became of a compile format of the project's own. */
export interface FormatChange {
  name: string;
  kind: 'added' | 'removed' | 'changed';
  changes: ValueChange[];
}

/** One document of an item that changed, with where the item is. */
export interface DocumentChange extends DocumentComparison {
  item: string;
  title: string;
  path: string[];
  part: DocumentPart;
}

export interface SynopsisChange {
  item: string;
  title: string;
  path: string[];
  was: string;
  now: string;
}

export interface ProjectComparison {
  items: BinderChange[];
  documents: DocumentChange[];
  synopses: SynopsisChange[];
  styles: StyleChange[];
  compile: ValueChange[];
  formats: FormatChange[];
  settings: ValueChange[];
}

/** The styles of two versions as one list: a renamed style goes by its new name in both. */
export function sharedStyles(was: Project, now: Project): Styles {
  const held = new Set(now.styles.map(({ id }) => id));
  const gone = was.styles.filter(({ id }) => !held.has(id));
  return { styles: [...now.styles, ...gone], files: now.files };
}

function compareStyles(was: Project, now: Project, shared: Styles): StyleChange[] {
  const before = new Map(was.styles.map((style) => [style.id, style]));
  const changes: StyleChange[] = [];
  for (const style of now.styles) {
    const { id, name } = style;
    const old = before.get(id);
    if (!old) changes.push({ id, name, kind: 'added', changes: [] });
    else {
      const held = valueChanges(styleFace(shared, old), styleFace(shared, style));
      if (held.length > 0) changes.push({ id, name, kind: 'changed', changes: held });
    }
    before.delete(id);
  }
  for (const { id, name } of before.values()) {
    changes.push({ id, name, kind: 'removed', changes: [] });
  }
  return changes;
}

/** The compile formats a project holds itself. */
export const ownFormats = (project: Project) =>
  listFormats(project).filter(({ source }) => source === 'project');

function compareFormats(was: FoundFormat[], now: FoundFormat[]): FormatChange[] {
  const before = new Map(was.map((format) => [format.name, format]));
  const changes: FormatChange[] = [];
  for (const { name, model } of now) {
    const old = before.get(name);
    before.delete(name);
    if (!old) changes.push({ name, kind: 'added', changes: [] });
    else if (!same(old.model, model)) {
      changes.push({ name, kind: 'changed', changes: valueChanges(old.model, model) });
    }
  }
  for (const { name } of before.values()) changes.push({ name, kind: 'removed', changes: [] });
  return changes;
}

/** Compares two versions of a project.  Nothing here prints, and nothing changes either. */
export function compareProjects(was: ProjectVersion, now: ProjectVersion): ProjectComparison {
  const shared = sharedStyles(was.project, now.project);
  const items = compareBinders(was, now);
  const documents: DocumentChange[] = [];
  const synopses: SynopsisChange[] = [];
  const kept = binderPlaces(now);
  const gone = [...binderPlaces(was)].filter(([id]) => !kept.has(id));
  for (const [id, { path }] of [...kept, ...gone]) {
    const title = path.at(-1)!;
    for (const part of ['content', 'notes'] as const) {
      const after = kept.has(id) ? now.documents.text(id, part) : readDocumentText('');
      const compared = compareDocument(shared, was.documents.text(id, part), after);
      if (compared.changed) documents.push({ ...compared, item: id, title, path, part });
    }
    const before = was.documents.synopsis(id);
    const after = kept.has(id) ? now.documents.synopsis(id) : '';
    if (before !== after) synopses.push({ item: id, title, path, was: before, now: after });
  }
  return {
    items,
    documents,
    synopses,
    styles: compareStyles(was.project, now.project, shared),
    compile: valueChanges(was.project.compileSettings, now.project.compileSettings),
    formats: compareFormats(ownFormats(was.project), ownFormats(now.project)),
    settings: valueChanges(projectSettings(was.project), projectSettings(now.project)),
  };
}
