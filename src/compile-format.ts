import { localFiles } from './local-files.ts';
import type { Files } from './files.ts';
import * as path from 'pathe';
import type { MetadataValue } from './compile-xml.ts';
import type { Project } from './project.ts';
import { type Replacement } from './replacements.ts';
import { type Scrformat, scrformat, writeScrformat } from './scrformat.ts';
import {
  type SectionLayout,
  type Separators,
  readLayout,
  readSeparators,
} from './section-layout.ts';
import { refuseUnknown, stopOnUnknown, UnsupportedError } from './unsupported.ts';
import { type Unread, newUnread } from './xml-codec.ts';
import { readXml } from './xml.ts';

/** Where a compile format was found. */
export type FormatSource = 'project' | 'user' | 'built-in';

/** The compile file type the CLI writes: plain MultiMarkdown. */
export const MULTIMARKDOWN = 'mmd';

const FORMAT_EXTENSION = '.scrformat';

const DEFAULT_APP = '/Applications/Scrivener.app';

const PROJECT_FORMATS = ['Settings', 'Compile Formats'];

const USER_FORMATS = ['Library', 'Application Support', 'Scrivener', 'CompileFormats'];

const BUILT_IN_FORMATS = ['Contents', 'Resources', 'Default Support Folder', 'CompileFormats'];

/** A `.scrformat` file the CLI can find. */
export interface FormatFile {
  name: string;
  id: string;
  file: string;
  source: FormatSource;
}

/** A style's compile settings, matched to the project's styles by name. */
export interface FormatStyle {
  prefix: string;
  suffix: string;
  /** Inserted at the start of every non-empty line in the style's range. */
  paraPrefix: string;
  /** The styled text is left out of the compile. */
  deleteText: boolean;
  /** A paragraph style that sets no character attributes (`Type="Para"`). */
  paragraphOnly: boolean;
  /** Treat as raw markup: converting rich text leaves the styled text as it is. */
  rawMarkup: boolean;
}

/** A compile format, with every setting the compile reads. */
export interface CompileFormat extends FormatFile {
  layouts: Map<string, SectionLayout>;
  folderSeparators: Separators;
  textSeparators: Separators;
  styles: Map<string, FormatStyle>;
  /** Names of the styles given MultiMarkdown functions. */
  blockQuoteStyle?: string;
  codeBlockStyle?: string;
  codeSpanStyle?: string;
  captionStyle?: string;
  removeSmartPunctuation: boolean;
  /** Paragraph spacing becomes empty lines, by "Convert to plain text". */
  paragraphSpacing: boolean;
  usePandocSyntax: boolean;
  replacements: Replacement[];
  /** Titles end with the same hashes they start with: `## Title ##`. */
  addClosingHashes: boolean;
  /** Wraps an annotation the compile keeps. */
  annotationPrefix: string;
  annotationSuffix: string;
  /** How a kept linked comment is written, with `<$lnk>` for its text and `<$cmt>` for the comment. */
  commentFormat: string;
  /** A layout's notes come before its text instead of after it. */
  notesBeforeText: boolean;
  /** Each included part (synopsis, notes, text) is headed `**Synopsis**`, `**Notes**`, `**Text**`. */
  includeSubtitles: boolean;
  /** The format's metadata, with `undefined` where the project's metadata goes. */
  metadata: (MetadataValue | undefined)[];
  /** Document links to a section take its title's prefix and suffix (Document Title Links). */
  updateTitleLinks: boolean;
}

/** The Remove smart punctuation transformation: each curly mark, and the plain text for it. */
export const SMART_PUNCTUATION: [RegExp, string][] = [
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/…/g, '...'],
  [/—/g, '---'],
  [/–/g, '--'],
];

/** Where a project keeps a format of a name, as a file. */
export function projectFormatFile({ dir }: Pick<Project, 'dir'>, name: string): string {
  const file = name.replaceAll('/', '-');
  return path.join(dir, ...PROJECT_FORMATS, `${file}${FORMAT_EXTENSION}`);
}

/** A format of another copy of a project as this one holds it: its file keeps its own name. */
export const formatIn = ({ dir }: Pick<Project, 'dir'>, format: FoundFormat): FoundFormat => ({
  ...format,
  file: path.join(dir, ...PROJECT_FORMATS, path.basename(format.file)),
});

/** The folders Scrivener keeps compile formats in, project formats first. */
function formatFolders(project: Project): { source: FormatSource; dir: string }[] {
  const own: { source: FormatSource; dir: string } = {
    source: 'project',
    dir: path.join(project.dir, ...PROJECT_FORMATS),
  };
  const machine = project.files.machine?.();
  if (!machine) return [own];
  return [
    own,
    { source: 'user', dir: path.join(machine.home, ...USER_FORMATS) },
    { source: 'built-in', dir: path.join(machine.app ?? DEFAULT_APP, ...BUILT_IN_FORMATS) },
  ];
}

/** Every compile format the CLI can find, project formats first. */
export function listFormats(project: Project): FoundFormat[] {
  return formatFolders(project).flatMap(({ source, dir }) =>
    project.files.exists(dir)
      ? project.files
          .list(dir)
          .filter((name) => name.endsWith(FORMAT_EXTENSION))
          .toSorted()
          .map((name) => readFormatFile(path.join(dir, name), source, project.files))
      : [],
  );
}

/** A compile format read whole from its file: where it is, its model, and what that misses. */
export interface FoundFormat extends FormatFile {
  model: Scrformat;
  /** What the file holds that the library does not know, or leaves out. */
  unsupported: Unread;
}

/** Reads a compile format's file. */
export function readFormatFile(
  file: string,
  source: FormatSource,
  files: Files = localFiles,
): FoundFormat {
  const found = newUnread();
  const model = scrformat.read(readXml(file, 'CompileFormat', files), found);
  return {
    name: model.name || path.basename(file, FORMAT_EXTENSION),
    id: model.id,
    file,
    source,
    model,
    unsupported: found,
  };
}

/**
 * A compile format as its `.scrformat` file, as Scrivener writes it.  Refuses a format read with
 * anything the library does not know, or without something Scrivener writes, which writing would
 * drop or make up.
 */
export function writeFormat({ model, unsupported }: FoundFormat): string {
  refuseUnknown(`the compile format "${model.name}"`, unsupported);
  return writeScrformat(model);
}

/**
 * Finds a compile format by name, file name or path.  With none given, it is the format the
 * project last compiled to MultiMarkdown with.
 */
export function findFormat(
  project: Project,
  request: string | undefined,
  lastUsedId: string,
): CompileFormat {
  if (request?.endsWith(FORMAT_EXTENSION) && project.files.exists(request)) {
    return compileFormat(readFormatFile(path.resolve(request), 'project', project.files));
  }
  const formats = listFormats(project);
  const found = formats.find((format) =>
    request === undefined
      ? format.id === lastUsedId
      : format.name === request || path.basename(format.file, FORMAT_EXTENSION) === request,
  );
  if (!found) {
    const wanted = request ?? `the last used format (${lastUsedId || 'none'})`;
    throw new Error(
      `Compile format not found: ${wanted}.  Found: ${formats.map((format) => format.name).join(', ')}`,
    );
  }
  return compileFormat(found);
}

/** "Convert to plain text" set to paragraph spacing, as a format stores it. */
const PARAGRAPH_SPACING = 'Para';

/** A format as the compile reads it, stopping on any setting the library does not implement. */
function compileFormat(found: FoundFormat): CompileFormat {
  const { model, name } = found;
  stopOnUnknown(`compile format "${name}"`, found.unsupported);
  if (!model.supportedTypes.includes(MULTIMARKDOWN)) {
    throw new UnsupportedError(`format "${name}" does not compile to MultiMarkdown`);
  }
  if (model.postProcessing?.enabled) throw new UnsupportedError('post-processing');
  const { transformations, mmd } = model;
  const conversion = transformations?.plainTextConversion;
  const converting = conversion?.state === 'On';
  if (converting && conversion.conversion !== PARAGRAPH_SPACING) {
    throw new UnsupportedError(`transformation PlainTextConversion ${conversion.conversion}`);
  }
  if (transformations?.outlineIndent?.state === 'On') {
    throw new UnsupportedError('transformation OutlineIndent');
  }
  if (model.tables?.convertToImages.convert) {
    throw new UnsupportedError('tables converted to images');
  }
  if (mmd?.pageTitleStyleId !== undefined) {
    throw new UnsupportedError('MultiMarkdown setting PageTitleStyleID');
  }
  const styles = model.styles ?? [];
  const styleName = (id: string | undefined) => styles.find((style) => style.id === id)?.name ?? '';
  const comments = model.footnotesAndComments?.comments;
  const commentFormat = comments?.commentFormat;
  const format: CompileFormat = {
    name,
    id: found.id,
    file: found.file,
    source: found.source,
    layouts: new Map(
      model.sectionLayouts.map((layout) => [layout.id, readLayout(layout, styleName)]),
    ),
    folderSeparators: readSeparators(model.separatorSettings.folderSeparators),
    textSeparators: readSeparators(model.separatorSettings.textSeparators),
    styles: new Map(
      styles.map((style) => [
        style.name,
        {
          prefix: style.prefix ?? '',
          suffix: style.suffix ?? '',
          paraPrefix: style.paraPrefix ?? '',
          deleteText: style.deleteText === true,
          paragraphOnly: style.type === 'Para',
          rawMarkup: style.rawMarkup === true,
        },
      ]),
    ),
    removeSmartPunctuation: transformations?.removeSmartPunctuation === true,
    paragraphSpacing: converting,
    usePandocSyntax: mmd?.usePandocSyntax === true,
    replacements: model.replacements,
    addClosingHashes: mmd?.addClosingHashesToTitles === true,
    annotationPrefix: comments?.annotationPrefix ?? '',
    annotationSuffix: comments?.annotationSuffix ?? '',
    // With no comment format, the comment follows the text it is linked to.
    commentFormat: commentFormat?.use ? commentFormat.template : '<$lnk> <$cmt>',
    notesBeforeText: model.formattingOptions?.notesBeforeText === true,
    includeSubtitles: model.formattingOptions?.includeSubtitles === true,
    updateTitleLinks: model.titleLinks?.updateLinksWithPrefixAndSuffix?.update === true,
    metadata: (mmd?.metadata ?? []).map(({ isProjectMetadataPlaceholder, key, value }) =>
      isProjectMetadataPlaceholder ? undefined : { key: key ?? '', value },
    ),
  };
  // The styles given MultiMarkdown meanings, where the format names one it has.
  const blockQuoteStyle = styleName(mmd?.blockQuoteStyleId);
  if (blockQuoteStyle) format.blockQuoteStyle = blockQuoteStyle;
  const codeBlockStyle = styleName(mmd?.codeBlockStyleId);
  if (codeBlockStyle) format.codeBlockStyle = codeBlockStyle;
  const codeSpanStyle = styleName(mmd?.codeSpanId);
  if (codeSpanStyle) format.codeSpanStyle = codeSpanStyle;
  const captionStyle = styleName(mmd?.captionStyleId);
  if (captionStyle) format.captionStyle = captionStyle;
  return format;
}
