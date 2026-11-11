/**
 * A new project.  Scrivener refuses a project file written by hand, so this starts from a blank
 * project it wrote (`blank-project.ts`) and gives it what must be its own: its name, its IDs, its
 * dates, and styles and a compile format of its own.  It works on `Files`, so a browser can do it.
 */
import { localFiles } from './local-files.ts';
import { type Files, newId, textBytes } from './files.ts';
import * as path from 'pathe';
import {
  COMPILE_SETTINGS,
  FORMAT_VERSION,
  MAC_WINDOW_STATE,
  PROJECT_FILE,
  WINDOW_STATE,
} from './blank-project.ts';
import { projectFormatFile } from './compile-format.ts';
import { compileXml, writeCompileXml } from './compile-xml.ts';
import { dateStamp } from './dates.ts';
import { EditError } from './edit-pieces.ts';
import {
  chooseProjectFormat,
  newProjectFormat,
  newProjectStyles,
  plainTextSample,
} from './new-project-look.ts';
import { flatten, openProject, type Project } from './project.ts';
import { preferencesFile } from './project-settings.ts';
import { writeStyles } from './project-styles.ts';
import { writeScrformat } from './scrformat.ts';
import { type Scrivx, scrivxFile, writeScrivx } from './scrivx.ts';
import { showItem } from './shown-item.ts';
import { newUnread, writeXml } from './xml-codec.ts';
import { parseXml } from './xml.ts';

/** What every new project says it was made on: Scrivener reads this as the last device to save. */
const DEVICE = 'scriv-tools';

/** Characters a project cannot have in its name, which is a folder's. */
const NOT_IN_A_NAME = /[/\\:]/;

/** Whether a project can be called this. */
export const isProjectName = (name: string) => name.trim() !== '' && !NOT_IN_A_NAME.test(name);

/** How Quick Look shows a project on a Mac, until Scrivener writes its own. */
const quickLook = (name: string) =>
  `<html>\n<head>\n<title></title>\n<meta charset="utf-8">\n</head>\n<body>\n<p>${name}</p>\n</body>\n</html>\n`;

/** Text escaped for an HTML page. */
const htmlText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The blank project file with IDs and dates of its own, and the IDs its section types had. */
function freshProjectFile(now: Date) {
  const scrivx: Scrivx = scrivxFile.read(parseXml(PROJECT_FILE, 'ScrivenerProject')!, newUnread());
  const stamp = dateStamp(now);
  const tomorrow = dateStamp(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  scrivx.identifier = newId();
  scrivx.device = DEVICE;
  scrivx.modified = stamp;
  scrivx.modId = newId();
  for (const item of flatten(scrivx.binder)) {
    item.id = newId();
    item.created = stamp;
    item.modified = stamp;
  }
  for (const collection of scrivx.collections) collection.id = newId();
  const types = new Map(scrivx.sectionTypes.definitions.map(({ id }) => [id, newId()]));
  const fresh = (id: string) => types.get(id)!;
  const { definitions, levels } = scrivx.sectionTypes;
  scrivx.sectionTypes = {
    definitions: definitions.map((type) => ({ ...type, id: fresh(type.id) })),
    levels: {
      folders: levels.folders.map(fresh),
      containers: levels.containers.map(fresh),
      files: levels.files.map(fresh),
    },
  };
  scrivx.targets.draft.deadline = stamp;
  scrivx.targets.session.nextResetDate = tomorrow;
  scrivx.targets.previousSession.date = stamp;
  scrivx.writingHistory.date = stamp;
  return { scrivx, types };
}

/** The blank compile settings for a project of this name and section types. */
function freshCompileSettings(name: string, types: Map<string, string>) {
  const settings = compileXml.read(parseXml(COMPILE_SETTINGS, 'CompileSettings')!, newUnread());
  const { metadata, options } = settings.projectSettings;
  options.convertLinksToMmd = true;
  metadata.projectTitle = name;
  metadata.abbreviatedTitle = name;
  // `<$author>` comes from the Mac, which a project made here knows nothing of.
  metadata.mmd = metadata.mmd.filter(({ key }) => key !== 'Author');
  for (const format of settings.formats) {
    format.sectionLayouts = format.sectionLayouts.map(({ typeId, layoutId }) => ({
      typeId: types.get(typeId)!,
      layoutId,
    }));
  }
  return settings;
}

/**
 * Creates a project called `name` in the folder `parent`, with one empty document in its Draft,
 * and opens it.  Nothing is there first: an existing project stops it.
 */
export function createProject(
  parent: string,
  name: string,
  files: Files = localFiles,
  now = new Date(),
): Project {
  if (!isProjectName(name)) throw new EditError(`A project cannot be called "${name}".`);
  const dir = path.join(parent, `${name}.scriv`);
  if (files.exists(dir)) throw new EditError(`${dir} is already there.`);
  const write = (file: string, text: string) => files.write(path.join(dir, file), textBytes(text));
  const { scrivx, types } = freshProjectFile(now);
  const format = newProjectFormat();
  const settings = freshCompileSettings(name, types);
  chooseProjectFormat(settings, scrivx.sectionTypes, format);
  const unsupported = { scrivx: newUnread(), styles: newUnread(), compileSettings: newUnread() };
  write(`${name}.scrivx`, writeScrivx(scrivx));
  write('Files/version.txt', String(FORMAT_VERSION));
  write('Files/Data/docs.checksum', '');
  write('Files/styles.xml', writeStyles({ styles: newProjectStyles(), unsupported }));
  write('Settings/compile.xml', writeCompileXml(settings, unsupported));
  write('Settings/ui-common.xml', WINDOW_STATE);
  write('Settings/ui.plist', MAC_WINDOW_STATE);
  write('Settings/recents.txt', '');
  write(
    'Settings/projectpreferences.xml',
    writeXml(
      preferencesFile.write({
        version: '1.0',
        useProjectPreferences: false,
        textFormat: plainTextSample(),
        useCustomFootnotesFont: undefined,
        footnotesFont: undefined,
        footnoteMarker: undefined,
      }),
    ),
  );
  write('QuickLook/Preview.html', quickLook(htmlText(name)));
  files.write(projectFormatFile({ dir }, format.name), textBytes(writeScrformat(format)));
  const project = openProject(dir, files);
  const [first] = project.binder.flatMap(({ children }) => children);
  showItem(project, first!.id);
  return project;
}
