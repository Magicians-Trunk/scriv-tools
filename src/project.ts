import { localFiles } from './local-files.ts';
import type { Files } from './files.ts';
import * as path from 'pathe';
import { type BinderItem } from './binder-item.ts';
import { type Documents } from './document.ts';
import { markupText } from './markup.ts';
import { type Scrivx, scrivxFile } from './scrivx.ts';
import { type Unread, newUnread } from './xml-codec.ts';
import { type CompileXml, compileXml } from './compile-xml.ts';
import { type ProjectStyle, stylesFile } from './project-styles.ts';
import { readXml } from './xml.ts';

/**
 * An open Scrivener project: its folder, everything its `.scrivx` file holds, and its style
 * names.  Its documents are read apart from it (`projectDocuments`).
 */
export interface Project extends Scrivx {
  dir: string;
  /** Where the project's files are. */
  files: Files;
  /** The `.scrivx` file's path. */
  file: string;
  /** The project's styles, from `Files/styles.xml`. */
  styles: ProjectStyle[];
  /** The project's compile settings, from `Settings/compile.xml`; none before its first compile. */
  compileSettings?: CompileXml;
  /**
   * What each of the project's files holds that the library does not know, so cannot write back:
   * an attribute, an element or a value.  The project is read without it, and a file is not
   * written while it holds any.
   */
  unsupported: ProjectUnsupported;
}

/** What each of the project's files holds that the library does not know. */
export interface ProjectUnsupported {
  scrivx: Unread;
  styles: Unread;
  compileSettings: Unread;
}

/** Whether a file is a project's own: its `.scrivx`. */
export const isProjectFile = (name: string) => path.extname(name) === '.scrivx';

/** Whether a folder is a project: a `.scriv`. */
export const isProjectFolder = (name: string) => path.extname(name) === '.scriv';

/** Opens a project from its `.scrivx` file or its `.scriv` folder. */
export function openProject(input: string, files: Files = localFiles): Project {
  const resolved = path.resolve(input);
  if (!files.exists(resolved)) throw new Error(`Project not found: ${resolved}`);
  let file = resolved;
  if (files.isDirectory(resolved)) {
    const found = files.list(resolved).filter(isProjectFile);
    if (found.length !== 1) throw new Error(`Expected one .scrivx file in ${resolved}`);
    file = path.join(resolved, found[0]!);
  }
  const dir = path.dirname(file);
  const found: ProjectUnsupported = {
    scrivx: newUnread(),
    styles: newUnread(),
    compileSettings: newUnread(),
  };
  const scrivx = scrivxFile.read(readXml(file, 'ScrivenerProject', files), found.scrivx);
  const stylesPath = path.join(dir, 'Files', 'styles.xml');
  const compilePath = path.join(dir, 'Settings', 'compile.xml');
  const project: Project = {
    ...scrivx,
    dir,
    files,
    file,
    styles: files.exists(stylesPath)
      ? stylesFile.read(readXml(stylesPath, 'Styles', files), found.styles).styles
      : [],
    unsupported: found,
  };
  if (files.exists(compilePath)) {
    project.compileSettings = compileXml.read(
      readXml(compilePath, 'CompileSettings', files),
      found.compileSettings,
    );
  }
  return project;
}

/** The name of the project's style with the ID; empty when the project has no such style. */
export function styleName(
  { styles }: { styles: Pick<ProjectStyle, 'id' | 'name'>[] },
  id: string | undefined,
): string {
  return styles.find((style) => style.id === id)?.name ?? '';
}

/** Every item under `items`, in binder order, each before its children. */
export function flatten<T extends { children: T[] }>(items: T[]): T[] {
  return items.flatMap((item) => [item, ...flatten(item.children)]);
}

/** A binder, looked up without walking it each time; built from it, so stale once it changes. */
export interface BinderIndex {
  byId: Map<string, BinderItem>;
  parents: Map<BinderItem, BinderItem>;
  /** The first item in binder order with each title. */
  byTitle: Map<string, BinderItem>;
}

export function indexBinder(binder: BinderItem[]): BinderIndex {
  const index: BinderIndex = { byId: new Map(), parents: new Map(), byTitle: new Map() };
  for (const item of flatten(binder)) {
    index.byId.set(item.id, item);
    if (item.title !== undefined && !index.byTitle.has(item.title)) {
      index.byTitle.set(item.title, item);
    }
    for (const descendant of item.children) index.parents.set(descendant, item);
  }
  return index;
}

/** The item with the binder ID; stops when there is none. */
export function findItem(index: Pick<BinderIndex, 'byId'>, id: string): BinderItem {
  const item = index.byId.get(id);
  if (!item) throw new Error(`No binder item with id ${id}`);
  return item;
}

/** The item's ancestors, from the top of the binder down to its parent. */
export function ancestorsOf(index: BinderIndex, item: BinderItem): BinderItem[] {
  const chain: BinderItem[] = [];
  for (let parent = index.parents.get(item); parent; parent = index.parents.get(parent)) {
    chain.unshift(parent);
  }
  return chain;
}

/** What a project is called: its folder's name. */
export const projectName = ({ dir }: Pick<Project, 'dir'>) => path.basename(dir, '.scriv');

/** The project's Draft folder, which every compile starts from. */
export function draftFolder(project: Pick<Project, 'binder'>): BinderItem {
  const draft = project.binder.find((item) => item.type === 'DraftFolder');
  if (!draft) throw new Error('The project has no Draft folder.');
  return draft;
}

/**
 * The title Scrivener shows for an item: its binder title, else the first line of its synopsis,
 * else the first line of its text, else "Untitled Document" or "Untitled Folder".
 */
export function adaptiveTitle(item: BinderItem, documents: Documents): string {
  if (item.title !== undefined) return item.title;
  const paragraphs = documents
    .text(item.id)
    .paragraphs.map((paragraph) => markupText(paragraph.content));
  return derivedTitle(item.type, documents.synopsis(item.id), paragraphs);
}

/** The title an item takes from a synopsis and its text's lines, with no binder title. */
export function derivedTitle(type: string, synopsis: string, lines: readonly string[]) {
  const untitled = type === 'Folder' ? 'Untitled Folder' : 'Untitled Document';
  return firstLine(synopsis.split('\n')) ?? firstLine(lines) ?? untitled;
}

/** The first line with text in it, without the spaces around it, as Scrivener titles an item. */
function firstLine(lines: readonly string[]): string | undefined {
  return lines.map((line) => line.trim()).find((line) => line !== '');
}

/**
 * The item's section type: the one chosen by hand, else the project's default for its kind
 * (folder, text with children, text) at its level.  The last level listed covers every deeper one.
 */
export function sectionTypeId(
  project: Project,
  item: BinderItem,
  level: number,
  inherited?: string,
): string | undefined {
  const chosen = item.metadata?.sectionType?.id;
  if (chosen) return chosen;
  if (inherited !== undefined) return inherited;
  const folder = item.type.endsWith('Folder');
  const kind = folder ? 'folders' : item.children.length > 0 ? 'containers' : 'files';
  const types = project.sectionTypes.levels[kind];
  return types[Math.min(level, types.length - 1)];
}

/** Scrivener's "No Label" and "No Status" entries' ID. */
export const NONE_ID = '-1';

/** The name of the item's label; none when it has none, or one the project does not list. */
export function labelName(project: Project, item: BinderItem): string | undefined {
  const id = item.metadata?.labelId;
  if (id === NONE_ID) return undefined;
  return project.labelSettings.labels.find((label) => label.id === id)?.name;
}

/** The name of the item's status; none when it has none, or one the project does not list. */
export function statusName(project: Project, item: BinderItem): string | undefined {
  const id = item.metadata?.statusId;
  if (id === NONE_ID) return undefined;
  return project.statusSettings.statuses.find((status) => status.id === id)?.name;
}

/** The name of the section type with the ID, if the project lists it. */
export function sectionTypeName(project: Project, id: string | undefined): string | undefined {
  return project.sectionTypes.definitions.find((type) => type.id === id)?.name;
}
