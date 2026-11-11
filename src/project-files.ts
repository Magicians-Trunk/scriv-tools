/**
 * The files around a project's binder and documents, as typed data: window state, settings,
 * search index, checksums, and the backups of the binder.  Each is read when it is there, and
 * written back only when its data changed, as Scrivener wrote it.
 */
import { localFiles } from './local-files.ts';
import { type Files, readText, textBytes } from './files.ts';
import * as path from 'pathe';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readPlist, type PlistValue, writePlist } from './plist.ts';
import {
  favoritesFile,
  folderSyncFile,
  preferencesFile,
  templateInfoFile,
  writingHistoryFile,
} from './project-settings.ts';
import { type Scrivx, scrivxFile } from './scrivx.ts';
import { type Checksums, readChecksums, searchIndexFile, writeChecksums } from './search-index.ts';
import { type IniSection, type JsonValue, readIni, writeIni, writeJson } from './settings-forms.ts';
import { uiStateFile } from './ui-state.ts';
import { refuseUnknown } from './unsupported.ts';
import { type Codec, newUnread, type Unread, writeXml } from './xml-codec.ts';
import { parseXml, readXml } from './xml.ts';

/** What a codec reads. */
type Read<C> = C extends Codec<infer T> ? T : never;

/** The project's other files, each missing when the project has none. */
export interface ProjectFiles {
  /** `Files/version.txt`: the file format's version. */
  version?: number;
  /** `Settings/recents.txt`: the items last opened, newest first. */
  recents?: string[];
  checksums?: Checksums;
  searchIndex?: Read<typeof searchIndexFile>;
  uiState?: Read<typeof uiStateFile>;
  preferences?: Read<typeof preferencesFile>;
  favorites?: Read<typeof favoritesFile>;
  templateInfo?: Read<typeof templateInfoFile>;
  folderSync?: Read<typeof folderSyncFile>;
  writingHistory?: Read<typeof writingHistoryFile>;
  /** `Settings/ui.plist`: the Mac's window state. */
  uiPlist?: PlistValue;
  /** `Settings/pagesetup.plist`: the Mac's page setup. */
  pageSetup?: PlistValue;
  /** `Settings/template_compile.plist`: the compile a template starts with. */
  templateCompile?: PlistValue;
  /** `Settings/ui.ini`: Windows' window state. */
  uiIni?: IniSection[];
  /** `Settings/mobile.settings`: what iOS keeps. */
  mobileSettings?: JsonValue;
  /** `Settings/mobile-outline.states`: what iOS shows expanded. */
  mobileOutlineStates?: JsonValue;
  /** `QuickLook/Preview.html`: what the Mac's Quick Look shows. */
  preview?: string;
  /** The custom icons in `Icons/`, by file name. */
  icons?: string[];
  /** What each XML file holds that its model does not, by its place in the project. */
  unsupported: Map<string, Unread>;
}

const SEARCH_INDEX = 'Files/search.indexes';
const UI_STATE = 'Settings/ui-common.xml';
const PREFERENCES = 'Settings/projectpreferences.xml';
const FAVORITES = 'Settings/favorites.xml';
const TEMPLATE_INFO = 'Settings/templateinfo.xml';
const FOLDER_SYNC = 'Settings/User/folder-sync.settings';
const WRITING_HISTORY = 'Files/writing.history';

const PLISTS = [
  ['uiPlist', 'Settings/ui.plist'],
  ['pageSetup', 'Settings/pagesetup.plist'],
  ['templateCompile', 'Settings/template_compile.plist'],
] as const;

const JSONS = [
  ['mobileSettings', 'Settings/mobile.settings'],
  ['mobileOutlineStates', 'Settings/mobile-outline.states'],
] as const;

const VERSION = 'Files/version.txt';
const RECENTS = 'Settings/recents.txt';
const CHECKSUMS = 'Files/Data/docs.checksum';
const UI_INI = 'Settings/ui.ini';
const PREVIEW = 'QuickLook/Preview.html';

/** A file's text, when the project has it. */
function textOf(store: Files, dir: string, file: string): string | undefined {
  const full = path.join(dir, file);
  return store.exists(full) ? readText(store, full) : undefined;
}

/** Reads the project's other files. */
export function readProjectFiles(dir: string, store: Files = localFiles): ProjectFiles {
  const files: ProjectFiles = { unsupported: new Map() };
  const version = textOf(store, dir, VERSION);
  if (version !== undefined) files.version = Number(version);
  const recents = textOf(store, dir, RECENTS);
  if (recents !== undefined) files.recents = recents.split('\n').filter((id) => id !== '');
  const checksums = textOf(store, dir, CHECKSUMS);
  if (checksums !== undefined) files.checksums = readChecksums(checksums);
  const ini = textOf(store, dir, UI_INI);
  if (ini !== undefined) files.uiIni = readIni(ini);
  const preview = textOf(store, dir, PREVIEW);
  if (preview !== undefined) files.preview = preview;
  const icons = path.join(dir, 'Icons');
  if (store.exists(icons)) files.icons = store.list(icons).toSorted();
  for (const [key, file] of PLISTS) {
    const source = textOf(store, dir, file);
    if (source !== undefined) files[key] = readPlist(source);
  }
  for (const [key, file] of JSONS) {
    const source = textOf(store, dir, file);
    if (source !== undefined) files[key] = JSON.parse(source);
  }
  readXmlFiles(store, dir, files);
  return files;
}

/** One XML file's data when the project has it, noting what its model does not hold. */
function readXmlFile<T>(
  store: Files,
  dir: string,
  unsupported: ProjectFiles['unsupported'],
  file: string,
  codec: Codec<T>,
): T | undefined {
  const full = path.join(dir, file);
  if (!store.exists(full)) return undefined;
  const unread = newUnread();
  unsupported.set(file, unread);
  return codec.read(readXml(full, codec.name, store), unread);
}

function readXmlFiles(store: Files, dir: string, files: ProjectFiles): void {
  const read = <T>(file: string, codec: Codec<T>) =>
    readXmlFile(store, dir, files.unsupported, file, codec);
  const searchIndex = read(SEARCH_INDEX, searchIndexFile);
  if (searchIndex) files.searchIndex = searchIndex;
  const uiState = read(UI_STATE, uiStateFile);
  if (uiState) files.uiState = uiState;
  const preferences = read(PREFERENCES, preferencesFile);
  if (preferences) files.preferences = preferences;
  const favorites = read(FAVORITES, favoritesFile);
  if (favorites) files.favorites = favorites;
  const templateInfo = read(TEMPLATE_INFO, templateInfoFile);
  if (templateInfo) files.templateInfo = templateInfo;
  const folderSync = read(FOLDER_SYNC, folderSyncFile);
  if (folderSync) files.folderSync = folderSync;
  const writingHistory = read(WRITING_HISTORY, writingHistoryFile);
  if (writingHistory) files.writingHistory = writingHistory;
}

/** Each file `files` holds, as it would be written. */
function writtenFiles(files: ProjectFiles): Map<string, string> {
  const written = new Map<string, string>();
  const add = <T>(file: string, value: T | undefined, write: (held: T) => string) => {
    if (value !== undefined) written.set(file, write(value));
  };
  add(VERSION, files.version, String);
  add(RECENTS, files.recents, (ids) => ids.join('\n'));
  add(CHECKSUMS, files.checksums, writeChecksums);
  add(UI_INI, files.uiIni, (sections) => writeIni(sections));
  add(PREVIEW, files.preview, (held) => held);
  for (const [key, file] of PLISTS) add(file, files[key], writePlist);
  for (const [key, file] of JSONS) add(file, files[key], writeJson);
  add(SEARCH_INDEX, files.searchIndex, (held) => writeXml(searchIndexFile.write(held)));
  add(UI_STATE, files.uiState, (held) => writeXml(uiStateFile.write(held)));
  add(PREFERENCES, files.preferences, (held) => writeXml(preferencesFile.write(held)));
  add(FAVORITES, files.favorites, (held) => writeXml(favoritesFile.write(held)));
  add(TEMPLATE_INFO, files.templateInfo, (held) => writeXml(templateInfoFile.write(held)));
  add(FOLDER_SYNC, files.folderSync, (held) => writeXml(folderSyncFile.write(held)));
  add(WRITING_HISTORY, files.writingHistory, (held) => writeXml(writingHistoryFile.write(held)));
  return written;
}

/**
 * Writes what changed since `files` was read, and gives the files written.  A file holding what
 * its model does not know stops it, with nothing written.  What did not change stays as it is,
 * byte for byte, however it was written.
 */
export function writeProjectFiles(
  dir: string,
  files: ProjectFiles,
  store: Files = localFiles,
): string[] {
  const before = writtenFiles(readProjectFiles(dir, store));
  const changed = [...writtenFiles(files)].filter(([file, text]) => before.get(file) !== text);
  for (const [file] of changed) {
    const unread = files.unsupported.get(file);
    if (unread) refuseUnknown(file, unread);
  }
  for (const [file, text] of changed) {
    store.write(path.join(dir, file), textBytes(text));
  }
  return changed.map(([file]) => path.join(dir, file));
}

/** The project file a binder backup holds: `Files/binder.autosave` or `binder.backup`. */
export function readBinderBackup(file: string, store: Files = localFiles): Scrivx {
  const entries = Object.entries(unzipSync(store.read(file)));
  const held = entries.find(([name]) => name.endsWith('.scrivx'));
  if (!held) throw new Error(`${file} holds no project file.`);
  const root = parseXml(strFromU8(held[1]), 'ScrivenerProject');
  if (!root) throw new Error(`${file} holds no project.`);
  return scrivxFile.read(root, newUnread());
}

/** Writes a binder backup holding the project file's text, under its name. */
export function writeBinderBackup(
  file: string,
  name: string,
  scrivx: string,
  store: Files = localFiles,
): void {
  store.write(file, zipSync({ [name]: strToU8(scrivx) }));
}
