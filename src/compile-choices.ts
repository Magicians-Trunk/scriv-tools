/**
 * The choices a person makes in Scrivener's compile panel for MultiMarkdown, read and changed as
 * one flat record.  What they change lands in `project.compileSettings`; `saveProject` writes it
 * to `Settings/compile.xml`, where Scrivener reads the same choices.
 */
import { type CompileFormat, MULTIMARKDOWN } from './compile-format.ts';
import {
  type CompileFilter,
  compileFile,
  DEFAULT_CHOICES,
  frontMatterOf,
  readAssignment,
  readSettings,
} from './compile-settings.ts';
import type {
  CompileXml,
  ContentFilter,
  FormatChoices,
  MetadataValue,
  ProjectCompileSettings,
  ProjectOptions,
} from './compile-xml.ts';
import type { Project } from './project.ts';
import type { Replacement } from './replacements.ts';

/** A format as these choices know it. */
type NamedFormat = Pick<CompileFormat, 'id' | 'name'>;

/** What the compile panel chooses for the project, whichever format runs. */
export interface CompileChoices {
  /** `Included`, `Excluded` or `All`: the items a compile takes. */
  scope: string;
  /** The Draft folder's own text comes first. */
  includeGroupText: boolean;
  /** Leaves items out, or keeps only those, by a value. */
  filter?: CompileFilter | undefined;
  removeComments: boolean;
  removeAnnotations: boolean;
  removeFootnotes: boolean;
  deleteStruckThrough: boolean;
  removeHyperlinks: boolean;
  /** Convert rich text to MultiMarkdown: bold and italic, and lists and tables with them. */
  convertRichText: boolean;
  /** Converting rich text escapes Markdown's punctuation in the text. */
  escapeSpecialCharacters: boolean;
  convertLists: boolean;
  convertLinks: boolean;
  projectTitle: string;
  abbreviatedTitle: string;
  author: string;
  forename: string;
  surname: string;
  /** The MultiMarkdown metadata block, which may hold placeholders. */
  metadata: MetadataValue[];
  replacements: Replacement[];
}

/** What the compile panel chooses for one format. */
export interface FormatCompileChoices {
  /** The layout for each section type, both by ID. */
  layouts: Record<string, string>;
  /** The binder ID of the folder compiled before the Draft. */
  frontMatter?: string | undefined;
}

/** The project's compile choices. */
export function readCompileChoices(project: Project): CompileChoices {
  const settings = readSettings(project);
  const { options } = compileFile(project).projectSettings;
  return {
    scope: settings.scope,
    includeGroupText: settings.includeGroupText,
    ...(settings.filter ? { filter: settings.filter } : {}),
    removeComments: settings.text.removeComments,
    removeAnnotations: settings.text.removeAnnotations,
    removeFootnotes: settings.text.removeFootnotes,
    deleteStruckThrough: settings.text.deleteStruckThrough,
    removeHyperlinks: options.removeHyperlinks === true,
    convertRichText: options.convertRichTextToMmd?.convert === true,
    escapeSpecialCharacters: options.convertRichTextToMmd?.doNotEscape !== true,
    convertLists: options.convertTablesAndListsToMmd === true,
    convertLinks: options.convertLinksToMmd === true,
    projectTitle: settings.projectTitle,
    abbreviatedTitle: settings.abbreviatedTitle,
    author: settings.author,
    forename: settings.forename,
    surname: settings.surname,
    metadata: settings.metadata,
    replacements: settings.replacements,
  };
}

/** A contents filter as the settings file holds one: on, leaving out what matches. */
function writtenFilter(was: ContentFilter, filter: CompileFilter | undefined): ContentFilter {
  if (!filter) return { ...was, state: 'Off' };
  const on = { ...was, state: 'On', exclude: filter.keep !== true };
  if (filter.field === 'custom') {
    return { ...on, type: 'Custom', metadataFilterId: filter.fieldId, metadataId: filter.value };
  }
  if (filter.field === 'label') return { ...on, type: 'Label', label: filter.value };
  if (filter.field === 'status') return { ...on, type: 'Status', status: filter.value };
  return { ...on, type: 'Collection', collectionId: filter.value };
}

/** The author's name in the list of authors, keeping any other authors and the first's role. */
function withAuthor({ metadata }: ProjectCompileSettings, name: string) {
  const [first, ...rest] = metadata.authors ?? [];
  metadata.authors = name === '' ? rest : [{ ...first, name }, ...rest];
}

/**
 * Convert rich text to MultiMarkdown, and its Escape special characters, as changed.  A project
 * that never set them keeps writing nothing for them until one is set.
 */
function setRichText(options: ProjectOptions, convert?: boolean, escape?: boolean) {
  const was = options.convertRichTextToMmd;
  if (convert === undefined && escape === undefined) return;
  const { doNotEscape, ...kept } = was ?? { convert: false };
  const escaping = escape ?? doNotEscape !== true;
  const now = { ...kept, convert: convert ?? kept.convert };
  if (!was && !now.convert && escaping) return;
  options.convertRichTextToMmd = escaping ? now : { ...now, doNotEscape: true };
}

/** Changes the project's compile choices; what is not given stays. */
export function setCompileChoices(project: Project, changed: Partial<CompileChoices>): void {
  const settings = compileFile(project).projectSettings;
  const { content, options, metadata } = settings;
  if (changed.scope !== undefined) content.scope = changed.scope;
  if (changed.includeGroupText !== undefined) content.includeGroupText = changed.includeGroupText;
  if ('filter' in changed) content.filter = writtenFilter(content.filter, changed.filter);
  if (changed.removeComments !== undefined) options.removeComments = changed.removeComments;
  if (changed.removeAnnotations !== undefined) {
    options.removeAnnotations = changed.removeAnnotations;
  }
  if (changed.removeFootnotes !== undefined) options.removeFootnotes = changed.removeFootnotes;
  if (changed.deleteStruckThrough !== undefined) {
    options.deleteStruckThroughText = changed.deleteStruckThrough;
  }
  if (changed.removeHyperlinks !== undefined) options.removeHyperlinks = changed.removeHyperlinks;
  setRichText(options, changed.convertRichText, changed.escapeSpecialCharacters);
  if (changed.convertLists !== undefined) {
    options.convertTablesAndListsToMmd = changed.convertLists;
  }
  if (changed.convertLinks !== undefined) options.convertLinksToMmd = changed.convertLinks;
  if (changed.projectTitle !== undefined) metadata.projectTitle = changed.projectTitle;
  if (changed.abbreviatedTitle !== undefined) metadata.abbreviatedTitle = changed.abbreviatedTitle;
  if (changed.author !== undefined) withAuthor(settings, changed.author);
  if (changed.forename !== undefined) metadata.forename = changed.forename;
  if (changed.surname !== undefined) metadata.surname = changed.surname;
  if (changed.metadata) metadata.mmd = changed.metadata;
  if (changed.replacements) settings.replacements = changed.replacements;
}

/** The choices the project made for a format, or the default ones it goes by. */
export function readFormatChoices(project: Project, format: NamedFormat): FormatCompileChoices {
  const { layouts, frontMatter } = readAssignment(project, format);
  return {
    layouts: Object.fromEntries(layouts),
    ...(frontMatter === undefined ? {} : { frontMatter }),
  };
}

/** A format's own choices, begun from the default ones the first time it has any. */
function ownChoices(file: CompileXml, format: NamedFormat): FormatChoices {
  const own = file.formats.find(({ id }) => id === format.id);
  if (own) return own;
  const shared = file.formats.find(({ id }) => id === DEFAULT_CHOICES);
  const made = { sectionLayouts: [], ...structuredClone(shared), id: format.id };
  file.formats.push(made);
  return made;
}

/** The front matter folder, where the format's choices keep MultiMarkdown's. */
function setFrontMatter(choices: FormatChoices, folderId: string | undefined) {
  const front = frontMatterOf(choices);
  if (front) {
    front.add = folderId !== undefined;
    if (folderId !== undefined) front.folderId = folderId;
  } else if (folderId !== undefined) {
    choices.frontAndBackMatter = { defaultFront: { add: true, folderId } };
  }
}

/** Changes a format's choices, and makes it the format last used for MultiMarkdown. */
export function setFormatChoices(
  project: Project,
  format: NamedFormat,
  changed: Partial<FormatCompileChoices> = {},
): void {
  const file = compileFile(project);
  file.lastUsedFormats[MULTIMARKDOWN] = format.id;
  if (!changed.layouts && !('frontMatter' in changed)) return;
  const choices = ownChoices(file, format);
  if (changed.layouts) {
    choices.sectionLayouts = Object.entries(changed.layouts).map(([typeId, layoutId]) => ({
      typeId,
      layoutId,
    }));
  }
  if ('frontMatter' in changed) setFrontMatter(choices, changed.frontMatter);
}
