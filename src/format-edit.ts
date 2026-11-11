/**
 * Changing a compile format's design.  Only what a change names is touched, so the rest of the file
 * stays as Scrivener wrote it.  A format lives in its `.scrformat`; `saveProject` writes one given
 * in `formats`.
 */
import type { FoundFormat } from './compile-format.ts';
import { readAssignment } from './compile-settings.ts';
import { plainDocument } from './document.ts';
import { EditError } from './edit-pieces.ts';
import { newId } from './files.ts';
import {
  type FormatDesign,
  type LayoutDesign,
  layoutDesign,
  NO_SEPARATOR,
  NORMAL_CASE,
  readFormatDesign,
  type SeparatorsDesign,
  type StyleDesign,
} from './format-design.ts';
import type { Project } from './project.ts';
import { same } from './rich-text.ts';
import type { FormatMetadataValue, Scrformat } from './scrformat.ts';
import type {
  FormatStyleModel,
  LayoutSeparators,
  SectionLayoutModel,
  Separator,
  SeparatorChoices,
} from './scrformat-layouts.ts';

/** The separator a design's two fields make, as an "after" one when `after`. */
function separatorFrom(type: string, text: string, after = false): Separator {
  if (!after) return { type, text };
  return type === NO_SEPARATOR ? { use: false, type: 'Single', text } : { use: true, type, text };
}

function choicesFrom(design: SeparatorsDesign): SeparatorChoices {
  return {
    before: separatorFrom(design.before, design.beforeText),
    between: separatorFrom(design.between, design.betweenText),
    afterOverride: separatorFrom(design.after, design.afterText, true),
  };
}

/** Sets an optional field only when it says something new, leaving the file as it was. */
function setWhenChanged<Held extends object, Key extends keyof Held>(
  held: Held,
  key: Key,
  value: Held[Key],
  empty: Held[Key],
) {
  if ((held[key] ?? empty) !== value) held[key] = value;
}

const TITLE_FIELDS: (keyof LayoutDesign)[] = [
  'titlePrefix',
  'titleSuffix',
  'suffixAfterHashes',
  'titleCase',
  'prefixCase',
  'suffixCase',
  'runIn',
  'hashCount',
];

/** A prefix or suffix's case attribute, which Scrivener leaves off for normal letters. */
const caseOf = (letters: string) => (letters === NORMAL_CASE ? {} : { case: letters });

function setTitles(model: SectionLayoutModel, design: LayoutDesign, was: LayoutDesign) {
  if (TITLE_FIELDS.every((field) => design[field] === was[field])) return;
  const titles = { ...model.titles };
  titles.titleCase = design.titleCase;
  titles.runInHead = design.runIn;
  if (design.hashCount > 0) titles.mmdHashCount = design.hashCount;
  else delete titles.mmdHashCount;
  titles.prefix = { ...caseOf(design.prefixCase), text: design.titlePrefix };
  titles.suffix = {
    ...caseOf(design.suffixCase),
    hashesInside: design.suffixAfterHashes,
    text: design.titleSuffix,
  };
  model.titles = titles;
}

const SEPARATOR_FIELDS: (keyof LayoutDesign)[] = [
  'ownSeparators',
  'separatorBefore',
  'separatorBeforeText',
  'separatorBetween',
  'separatorBetweenText',
  'separatorAfter',
  'separatorAfterText',
];

function setSeparators(model: SectionLayoutModel, design: LayoutDesign, was: LayoutDesign) {
  if (SEPARATOR_FIELDS.every((field) => design[field] === was[field])) return;
  const separators: LayoutSeparators = {
    useDefault: !design.ownSeparators,
    before: separatorFrom(design.separatorBefore, design.separatorBeforeText),
    between: separatorFrom(design.separatorBetween, design.separatorBetweenText),
    afterOverride: separatorFrom(design.separatorAfter, design.separatorAfterText, true),
  };
  model.separators = separators;
}

/** Puts a layout's design on its model, touching only what differs. */
function setLayout(model: SectionLayoutModel, design: LayoutDesign) {
  const was = layoutDesign(model);
  model.name = design.name;
  setWhenChanged(model.include, 'titles', design.titles, false);
  setWhenChanged(model.include, 'metadata', design.metadata, false);
  setWhenChanged(model.include, 'synopses', design.synopsis, false);
  setWhenChanged(model.include, 'text', design.text, false);
  setWhenChanged(model.include, 'notes', design.notes, false);
  setTitles(model, design, was);
  if (design.prefix !== was.prefix || design.prefixAfterTitle !== was.prefixAfterTitle) {
    model.prefix = { afterTitle: design.prefixAfterTitle, document: plainDocument(design.prefix) };
  }
  if (
    design.suffix !== was.suffix ||
    design.suffixAfterSubdocuments !== was.suffixAfterSubdocuments
  ) {
    model.suffix = {
      afterSubdocs: design.suffixAfterSubdocuments,
      document: plainDocument(design.suffix),
    };
  }
  setWhenChanged(model, 'uppercasedFirstWords', design.uppercasedWords, 0);
  if (design.blankLine !== was.blankLine) {
    model.blankLineSeparator = { ...model.blankLineSeparator, text: design.blankLine };
  }
  setSeparators(model, design, was);
}

function setStyle(model: FormatStyleModel, design: StyleDesign) {
  model.name = design.name;
  model.type = design.type;
  setWhenChanged(model, 'prefix', design.prefix, '');
  setWhenChanged(model, 'suffix', design.suffix, '');
  setWhenChanged(model, 'paraPrefix', design.paraPrefix, '');
  setWhenChanged(model, 'deleteText', design.deleteText, false);
  setWhenChanged(model, 'rawMarkup', design.rawMarkup, false);
}

/** The layouts a project's choices for a format still use, its own or the default ones, by ID. */
function layoutsInUse(project: Project, format: FoundFormat) {
  if (!project.compileSettings) return new Set<string>();
  return new Set(readAssignment(project, format).layouts.values());
}

function setLayouts(project: Project, found: FoundFormat, layouts: LayoutDesign[]) {
  const { model } = found;
  const kept = new Set(layouts.map(({ id }) => id));
  const inUse = layoutsInUse(project, found);
  const gone = model.sectionLayouts.find(({ id }) => !kept.has(id) && inUse.has(id));
  if (gone) {
    throw new EditError(`The layout "${gone.name}" is still used: give its section types another.`);
  }
  model.sectionLayouts = layouts.map((design) => {
    const held = model.sectionLayouts.find(({ id }) => id === design.id);
    const layout = held ?? { name: design.name, id: design.id, include: {} };
    setLayout(layout, design);
    return layout;
  });
}

function setStyles({ model }: FoundFormat, styles: StyleDesign[]) {
  const held = model.styles ?? [];
  model.styles = styles.map((design) => {
    const style = held.find(({ id }) => id === design.id) ?? {
      name: design.name,
      id: design.id,
      type: design.type,
    };
    setStyle(style, design);
    return style;
  });
}

/** The format's metadata, with the place of the project's own kept. */
function setMetadata(model: Scrformat, values: FormatDesign['metadata']) {
  const mmd = (model.mmd ??= { metadata: [] });
  const at = mmd.metadata.findIndex((value) => value.isProjectMetadataPlaceholder);
  const keyed: FormatMetadataValue[] = values.map(({ key, value }) => ({ key, value }));
  if (at >= 0) keyed.splice(Math.min(at, keyed.length), 0, mmd.metadata[at]!);
  mmd.metadata = keyed;
}

/** The style for a meaning, or none. */
function setMeaning(
  mmd: NonNullable<Scrformat['mmd']>,
  key: 'blockQuoteStyleId' | 'codeBlockStyleId' | 'codeSpanId' | 'captionStyleId',
  id: string | undefined,
) {
  if (id === undefined) return;
  if (id === '') delete mmd[key];
  else mmd[key] = id;
}

/** The MultiMarkdown settings a change names, made as they are first needed. */
function setMmd(model: Scrformat, changed: Partial<FormatDesign>) {
  const named = [
    changed.usePandocSyntax,
    changed.addClosingHashes,
    changed.blockQuoteStyle,
    changed.codeBlockStyle,
    changed.codeSpanStyle,
    changed.captionStyle,
  ];
  if (named.every((value) => value === undefined)) return;
  const mmd = (model.mmd ??= { metadata: [] });
  if (changed.usePandocSyntax !== undefined) mmd.usePandocSyntax = changed.usePandocSyntax;
  if (changed.addClosingHashes !== undefined) {
    mmd.addClosingHashesToTitles = changed.addClosingHashes;
  }
  setMeaning(mmd, 'blockQuoteStyleId', changed.blockQuoteStyle);
  setMeaning(mmd, 'codeBlockStyleId', changed.codeBlockStyle);
  setMeaning(mmd, 'codeSpanId', changed.codeSpanStyle);
  setMeaning(mmd, 'captionStyleId', changed.captionStyle);
}

/** The comment settings, made as they are first needed. */
function commentsOf(model: Scrformat) {
  const held = (model.footnotesAndComments ??= {});
  return (held.comments ??= { annotationPrefix: '', annotationSuffix: '' });
}

/** Stops on a format that is not the project's own. */
export function refuseOthers({ source, name }: FoundFormat) {
  if (source !== 'project') {
    throw new EditError(`"${name}" is not the project's own: duplicate it first.`);
  }
}

/** What of a design differs from the format as it stands: the rest is left exactly as it was. */
function differences(found: FoundFormat, given: Partial<FormatDesign>): Partial<FormatDesign> {
  const was = new Map(Object.entries(readFormatDesign(found)));
  return Object.fromEntries(
    Object.entries(given).filter(([key, value]) => !same(was.get(key), value)),
  );
}

/** Changes a format's design; what is not given stays.  Only a project's own formats change. */
export function setFormatDesign(
  project: Project,
  found: FoundFormat,
  given: Partial<FormatDesign>,
): void {
  refuseOthers(found);
  const { model } = found;
  const changed = differences(found, given);
  if (changed.name !== undefined) model.name = changed.name;
  if (changed.styles) setStyles(found, changed.styles);
  if (changed.layouts) setLayouts(project, found, changed.layouts);
  const { separatorSettings } = model;
  if (changed.folderSeparators) {
    separatorSettings.folderSeparators = choicesFrom(changed.folderSeparators);
  }
  if (changed.textSeparators) {
    separatorSettings.textSeparators = choicesFrom(changed.textSeparators);
  }
  if (changed.removeSmartPunctuation !== undefined) {
    const transformations = (model.transformations ??= {});
    transformations.removeSmartPunctuation = changed.removeSmartPunctuation;
  }
  setMmd(model, changed);
  if (changed.notesBeforeText !== undefined || changed.includeSubtitles !== undefined) {
    model.formattingOptions = {
      notesBeforeText: changed.notesBeforeText ?? model.formattingOptions?.notesBeforeText ?? false,
      includeSubtitles:
        changed.includeSubtitles ?? model.formattingOptions?.includeSubtitles ?? false,
    };
  }
  if (changed.updateTitleLinks !== undefined) {
    const links = (model.titleLinks ??= {});
    links.updateLinksWithPrefixAndSuffix = {
      ...links.updateLinksWithPrefixAndSuffix,
      update: changed.updateTitleLinks,
    };
  }
  if (changed.annotationPrefix !== undefined) {
    commentsOf(model).annotationPrefix = changed.annotationPrefix;
  }
  if (changed.annotationSuffix !== undefined) {
    commentsOf(model).annotationSuffix = changed.annotationSuffix;
  }
  if (changed.commentTemplate !== undefined) {
    const template = changed.commentTemplate;
    commentsOf(model).commentFormat = { use: template !== '', template };
  }
  if (changed.replacements) model.replacements = changed.replacements;
  if (changed.metadata) setMetadata(model, changed.metadata);
}

/** A new layout's design: the title and text, with the format's separators. */
export function newLayoutDesign(name: string): LayoutDesign {
  return {
    id: newId(),
    name,
    titles: true,
    metadata: false,
    synopsis: false,
    text: true,
    notes: false,
    titlePrefix: '',
    titleSuffix: '',
    suffixAfterHashes: false,
    titleCase: NORMAL_CASE,
    prefixCase: NORMAL_CASE,
    suffixCase: NORMAL_CASE,
    runIn: false,
    hashCount: 0,
    prefix: '',
    prefixAfterTitle: false,
    suffix: '',
    suffixAfterSubdocuments: false,
    uppercasedWords: 0,
    blankLine: '',
    ownSeparators: false,
    separatorBefore: 'Single',
    separatorBeforeText: '',
    separatorBetween: 'Single',
    separatorBetweenText: '',
    separatorAfter: NO_SEPARATOR,
    separatorAfterText: '',
  };
}

/** A copy of a layout, under a new name. */
export const duplicateLayoutDesign = (layout: LayoutDesign): LayoutDesign => ({
  ...layout,
  id: newId(),
  name: `${layout.name} copy`,
});

/** A new style's design, writing nothing around its text yet. */
export function newStyleDesign(name: string, type: string): StyleDesign {
  return {
    id: newId(),
    name,
    type,
    prefix: '',
    suffix: '',
    paraPrefix: '',
    deleteText: false,
    rawMarkup: false,
  };
}
