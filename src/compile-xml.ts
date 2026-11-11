/**
 * The project's compile settings file, `Settings/compile.xml`: what to compile, the options, the
 * project's metadata, each format's section layout assignments, and the formats last used.
 */
import type { ProjectUnsupported } from './project.ts';
import { type Replacement, replacements } from './replacements.ts';
import { refuseUnknown } from './unsupported.ts';
import {
  attribute,
  child,
  closedWhenEmpty,
  type Codec,
  decimal,
  element,
  integer,
  list,
  namedChildren,
  optionalAttribute,
  optionalChild,
  optionalList,
  optionalTextChild,
  string,
  text,
  textChild,
  textElement,
  writeXml,
  yesNo,
} from './xml-codec.ts';

/** The contents filter: items it keeps or leaves out, by label, status, collection or value. */
export interface ContentFilter {
  state: string;
  exclude: boolean;
  type: string;
  /** The custom field a filter on a value reads. */
  metadataFilterId?: string;
  collectionId?: string;
  label?: string;
  status?: string;
  /** The value a filter on a custom field matches: for a list field, the option's ID. */
  metadataId?: string;
}

/** What to compile. */
export interface Content {
  /** `Included`, `Excluded` or `All`; missing, the items included in the compile. */
  scope?: string;
  treatAsComplete?: boolean;
  includeGroupText?: boolean;
  includeSelectionDescendants?: boolean;
  filter: ContentFilter;
}

export interface PdfSettings {
  cover: { source?: string; bleed: number; bleedUnits: string };
  compression: {
    enabled: boolean;
    imageResolutionCompressionType: string;
    imageResolution: number;
    compressionQuality: number;
  };
}

export interface ScriptwritingSettings {
  includeTitles: boolean;
  includeSynopses: boolean;
  commentsAsScriptNotes: boolean;
}

export interface EbookSettings {
  startAfterFrontMatter: boolean;
  cover: {
    imageDocument: { source: string };
    title: string;
    svg: { width: number; height: number; content: string };
  };
  toc: { pandocDepth: number; html: { generate: boolean; title: string } };
}

/**
 * Convert rich text to MultiMarkdown: `convert` ticks it, and `doNotEscape` clears its Escape
 * special characters, which is ticked when missing.
 */
export interface RichTextConversion {
  convert: boolean;
  doNotEscape?: boolean;
}

/** The compile's options, from the compile panel's options tab. */
export interface ProjectOptions {
  removeComments?: boolean;
  removeAnnotations?: boolean;
  removeFootnotes?: boolean;
  resampleImages: { dpi: number; resample: boolean };
  deleteStruckThroughText?: boolean;
  removeHyperlinks?: boolean;
  /** Convert rich text to MultiMarkdown, and whether it escapes Markdown's punctuation. */
  convertRichTextToMmd?: RichTextConversion;
  convertTablesAndListsToMmd?: boolean;
  convertLinksToMmd?: boolean;
  pdf: PdfSettings;
  scriptwriting: ScriptwritingSettings;
  ebook: EbookSettings;
}

export interface Author {
  /** The author's role, as an ebook writes it (`aut`). */
  role?: string;
  name: string;
}

/** A metadata key and its value, which may hold placeholders. */
export interface MetadataValue {
  key: string;
  value: string;
}

/** The project's metadata, from the compile panel's metadata tab. */
export interface ProjectMetadata {
  projectTitle: string;
  abbreviatedTitle: string;
  authors?: Author[];
  surname?: string;
  forename?: string;
  ebookLanguage: string;
  fountainTitlePage: MetadataValue[];
  mmd: MetadataValue[];
}

/** The front matter folder a format adds, by binder ID. */
export interface FrontMatter {
  add?: boolean;
  lock?: boolean;
  folderId: string;
}

/** The project's choices for one compile format. */
export interface FormatChoices {
  id: string;
  /** The layout for each section type, by section type ID. */
  sectionLayouts: { typeId: string; layoutId: string }[];
  frontAndBackMatter?: {
    defaultFront: FrontMatter;
    /** Front matter for a file type, in place of the default, by file type. */
    perFileType?: Record<string, { front: FrontMatter }>;
  };
}

/** The project's own compile settings: what to compile, replacements, options and metadata. */
export interface ProjectCompileSettings {
  content: Content;
  replacements: Replacement[];
  options: ProjectOptions;
  metadata: ProjectMetadata;
}

/** Everything in `Settings/compile.xml`. */
export interface CompileXml {
  projectSettings: ProjectCompileSettings;
  /** The file type last compiled to, such as `mmd`. */
  currentFileType: string;
  formats: FormatChoices[];
  /** The format last used for each file type, by file type. */
  lastUsedFormats: Record<string, string>;
}

const filter = element<ContentFilter>('Filter', {
  state: attribute('State', string),
  exclude: attribute('Exclude', yesNo),
  type: attribute('Type', string),
  metadataFilterId: optionalAttribute('MetaDataFilterID', string),
  collectionId: optionalTextChild('CollectionID', string),
  label: optionalTextChild('Label', string),
  status: optionalTextChild('Status', string),
  metadataId: optionalTextChild('MetaDataID', string),
});

const content = element<Content>('Content', {
  scope: optionalAttribute('Scope', string),
  treatAsComplete: optionalAttribute('TreatAsComplete', yesNo),
  includeGroupText: optionalAttribute('IncludeGroupText', yesNo),
  includeSelectionDescendants: optionalAttribute('IncludeSelectionDescendants', yesNo),
  filter: child(filter),
});

const pdf = element<PdfSettings>('PDF', {
  cover: child(
    element<PdfSettings['cover']>('Cover', {
      source: optionalAttribute('Source', string),
      bleed: attribute('Bleed', decimal),
      bleedUnits: attribute('BleedUnits', string),
    }),
  ),
  compression: child(
    element<PdfSettings['compression']>('Compression', {
      enabled: attribute('Enabled', yesNo),
      imageResolutionCompressionType: textChild('ImageResolutionCompressionType', string),
      imageResolution: textChild('ImageResolution', integer),
      compressionQuality: textChild('CompressionQuality', decimal),
    }),
  ),
});

const scriptwriting = element<ScriptwritingSettings>('Scriptwriting', {
  includeTitles: textChild('IncludeTitles', yesNo),
  includeSynopses: textChild('IncludeSynopses', yesNo),
  commentsAsScriptNotes: textChild('CommentsAsScriptNotes', yesNo),
});

const ebook = element<EbookSettings>('Ebook', {
  startAfterFrontMatter: textChild('StartAfterFrontMatter', yesNo),
  cover: child(
    element<EbookSettings['cover']>('Cover', {
      imageDocument: child(
        element<{ source: string }>('ImageDocument', { source: attribute('Source', string) }),
      ),
      title: textChild('Title', string),
      svg: child(
        element<EbookSettings['cover']['svg']>('SVG', {
          width: attribute('Width', integer),
          height: attribute('Height', integer),
          content: text(string, true),
        }),
      ),
    }),
  ),
  toc: child(
    element<EbookSettings['toc']>('TOC', {
      pandocDepth: attribute('PandocDepth', integer),
      html: child(
        element<EbookSettings['toc']['html']>('HTML', {
          generate: attribute('Generate', yesNo),
          title: textChild('Title', string),
        }),
      ),
    }),
  ),
});

const options = element<ProjectOptions>('Options', {
  removeComments: optionalTextChild('RemoveComments', yesNo),
  removeAnnotations: optionalTextChild('RemoveAnnotations', yesNo),
  removeFootnotes: optionalTextChild('RemoveFootnotes', yesNo),
  resampleImages: child(
    element<ProjectOptions['resampleImages']>('ResampleImages', {
      dpi: attribute('DPI', integer),
      resample: text(yesNo),
    }),
  ),
  deleteStruckThroughText: optionalTextChild('DeleteStruckThroughText', yesNo),
  removeHyperlinks: optionalTextChild('RemoveHyperlinks', yesNo),
  convertRichTextToMmd: optionalChild(
    element<RichTextConversion>('ConvertRichTextToMMD', {
      doNotEscape: optionalAttribute('DoNotEscape', yesNo),
      convert: text(yesNo),
    }),
  ),
  convertTablesAndListsToMmd: optionalTextChild('ConvertTablesAndListToMMD', yesNo),
  convertLinksToMmd: optionalTextChild('ConvertLinksToMMD', yesNo),
  pdf: child(pdf),
  scriptwriting: child(scriptwriting),
  ebook: child(ebook),
});

/** A metadata value: written as CDATA, which keeps placeholders as typed. */
const metadataValue = element<MetadataValue>('Value', {
  key: attribute('Key', string),
  value: text(string, true),
});

const metadata = element<ProjectMetadata>('MetaData', {
  projectTitle: textChild('ProjectTitle', string),
  abbreviatedTitle: textChild('ProjectAbbreviatedTitle', string),
  authors: optionalList(
    'Authors',
    element<Author>('Author', { role: optionalAttribute('Role', string), name: text(string) }),
  ),
  surname: optionalTextChild('Surname', string),
  forename: optionalTextChild('Forename', string),
  ebookLanguage: textChild('EbookLanguage', string),
  fountainTitlePage: list('FountainTitlePageMetaData', metadataValue),
  mmd: list('MMDMetaData', metadataValue),
});

const projectSettings = element<ProjectCompileSettings>('ProjectSettings', {
  content: child(content),
  replacements,
  options: child(options),
  metadata: child(metadata),
});

/** Front matter's folder, as `DefaultFrontMatter` or a file type's `Front`. */
const frontMatter = (name: string) =>
  element<FrontMatter>(name, {
    add: optionalAttribute('Add', yesNo),
    lock: optionalAttribute('Lock', yesNo),
    folderId: closedWhenEmpty(string),
  });

const formatChoices = element<FormatChoices>('Format', {
  id: attribute('ID', string),
  sectionLayouts: list(
    'SectionLayouts',
    element<{ typeId: string; layoutId: string }>('Type', {
      typeId: attribute('ID', string),
      layoutId: text(string),
    }),
  ),
  frontAndBackMatter: optionalChild(
    element<NonNullable<FormatChoices['frontAndBackMatter']>>('FrontAndBackMatter', {
      defaultFront: child(frontMatter('DefaultFrontMatter')),
      perFileType: optionalChild(
        namedChildren('PerFileTypeSettings', (type) =>
          element<{ front: FrontMatter }>(type, { front: child(frontMatter('Front')) }),
        ),
      ),
    }),
  ),
});

export const compileXml: Codec<CompileXml> = element<CompileXml>('CompileSettings', {
  projectSettings: child(projectSettings),
  currentFileType: textChild('CurrentFileType', string),
  formats: list('FormatSettings', formatChoices),
  lastUsedFormats: child(namedChildren('LastUsedFormats', (type) => textElement(type, string))),
});

/**
 * The project's compile settings as their file, as Scrivener writes it.  Refuses settings read
 * with anything the library does not know.
 */
export function writeCompileXml(
  settings: CompileXml,
  unsupported: Pick<ProjectUnsupported, 'compileSettings'>,
): string {
  refuseUnknown('the compile settings', unsupported.compileSettings);
  return writeXml(compileXml.write(settings));
}
