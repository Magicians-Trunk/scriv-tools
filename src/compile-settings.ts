import { type BinderItem } from './binder-item.ts';
import { type CompileFormat, MULTIMARKDOWN } from './compile-format.ts';
import {
  type CompileXml,
  type ContentFilter,
  type FormatChoices,
  type MetadataValue,
} from './compile-xml.ts';
import { type TextOptions } from './document-text.ts';
import { type Project } from './project.ts';
import { type Replacement } from './replacements.ts';
import { stopOnUnknown, UnsupportedError } from './unsupported.ts';

/** The project's compile settings, as the compile reads them from `Settings/compile.xml`. */
export interface CompileSettings {
  scope: string;
  includeGroupText: boolean;
  /** The compile's contents filter, which leaves out items with a value. */
  filter?: CompileFilter;
  text: TextOptions;
  projectTitle: string;
  abbreviatedTitle: string;
  author: string;
  forename: string;
  surname: string;
  metadata: MetadataValue[];
  lastUsedFormat: string;
  replacements: Replacement[];
}

/**
 * A contents filter on a label, a status, a collection, or a custom metadata value (for a list
 * field, the option's ID).  It leaves out what matches, or with `keep` only keeps what does.
 */
export type CompileFilter = { keep?: boolean } & (
  | { field: 'label' | 'status' | 'collection'; value: string }
  | { field: 'custom'; fieldId: string; value: string }
);

/** Whether a filter matches an item. */
function matchesFilter({ id, metadata }: BinderItem, filter: CompileFilter, project: Project) {
  if (filter.field === 'custom') return metadata?.custom[filter.fieldId] === filter.value;
  if (filter.field === 'collection') {
    const held = project.collections.find((collection) => collection.id === filter.value);
    return held?.binderIds?.includes(id) === true;
  }
  return (filter.field === 'label' ? metadata?.labelId : metadata?.statusId) === filter.value;
}

/** Whether the compile's contents filter leaves the item out. */
export function filteredOut(
  item: BinderItem,
  filter: CompileFilter | undefined,
  project: Project,
): boolean {
  if (!filter) return false;
  return matchesFilter(item, filter, project) === (filter.keep !== true);
}

/** The project's choices for a compile format: the layout for each section type, by ID. */
export interface FormatAssignment {
  layouts: Map<string, string>;
  /** The binder ID of the folder the format adds as front matter. */
  frontMatter?: string;
}

/** The project's compile settings file; stops when the project has never been compiled. */
export function compileFile(project: Project): CompileXml {
  if (!project.compileSettings) {
    throw new Error('The project has never been compiled, so it has no compile settings.');
  }
  return project.compileSettings;
}

/** The project's compile settings, as the compile reads them. */
export function readSettings(project: Project): CompileSettings {
  const file = compileFile(project);
  stopOnUnknown('compile settings', project.unsupported.compileSettings);
  const { content, options, metadata, replacements } = file.projectSettings;
  const rich = options.convertRichTextToMmd;
  const converting = rich?.convert === true;
  const settings: CompileSettings = {
    scope: content.scope ?? 'Included',
    includeGroupText: content.includeGroupText === true,
    text: {
      // Converting rich text converts tables and lists too, its own option disabled.
      convertLists: converting || options.convertTablesAndListsToMmd === true,
      convertLinks: options.convertLinksToMmd === true && options.removeHyperlinks !== true,
      removeAnnotations: options.removeAnnotations === true,
      removeComments: options.removeComments === true,
      removeFootnotes: options.removeFootnotes === true,
      deleteStruckThrough: options.deleteStruckThroughText === true,
      ...(converting ? { richText: { escape: rich.doNotEscape !== true } } : {}),
    },
    projectTitle: metadata.projectTitle,
    abbreviatedTitle: metadata.abbreviatedTitle,
    author: metadata.authors?.[0]?.name ?? '',
    forename: metadata.forename ?? '',
    surname: metadata.surname ?? '',
    metadata: metadata.mmd,
    lastUsedFormat: file.lastUsedFormats[MULTIMARKDOWN] ?? '',
    replacements,
  };
  const filter = contentFilter(content.filter);
  if (filter) settings.filter = filter;
  return settings;
}

/**
 * The contents filter.  One on the current selection stops the compile, which has none, as does
 * one with nothing to match.
 */
function contentFilter(filter: ContentFilter): CompileFilter | undefined {
  const { state, type, exclude } = filter;
  if (state !== 'On') return undefined;
  const keep = exclude ? {} : { keep: true };
  const value = {
    Label: filter.label,
    Status: filter.status,
    Collection: filter.collectionId,
    Custom: filter.metadataId,
  }[type];
  if (value === undefined) throw new UnsupportedError(`compile contents filter on ${type}`);
  if (type === 'Custom') {
    const fieldId = filter.metadataFilterId;
    if (fieldId === undefined) throw new UnsupportedError('compile contents filter on Custom');
    return { ...keep, field: 'custom', fieldId, value };
  }
  if (type === 'Label') return { ...keep, field: 'label', value };
  return { ...keep, field: type === 'Status' ? 'status' : 'collection', value };
}

/** The ID of the choices a format with none of its own takes. */
export const DEFAULT_CHOICES = 'DEFAULT';

/** A format's front matter: MultiMarkdown's own, when it has some; else the default. */
export function frontMatterOf({ frontAndBackMatter: matter }: FormatChoices) {
  return matter?.perFileType?.[MULTIMARKDOWN]?.front ?? matter?.defaultFront;
}

/** The project's layout for each section type, and front matter folder, for a format. */
export function readAssignment(
  project: Project,
  format: Pick<CompileFormat, 'id' | 'name'>,
): FormatAssignment {
  const { formats } = compileFile(project);
  // A format nothing was chosen for goes by the project's default choices.
  const assigned =
    formats.find((choices) => choices.id === format.id) ??
    formats.find((choices) => choices.id === DEFAULT_CHOICES);
  if (!assigned) {
    throw new Error(`The project has no section layouts assigned for format "${format.name}".`);
  }
  const layouts = new Map(
    assigned.sectionLayouts.map(({ typeId, layoutId }) => [typeId, layoutId]),
  );
  const front = frontMatterOf(assigned);
  return front?.add ? { layouts, frontMatter: front.folderId } : { layouts };
}
