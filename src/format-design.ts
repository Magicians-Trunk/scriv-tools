/**
 * A compile format's design, as Scrivener's format designer offers it for MultiMarkdown: its
 * section layouts, separators, styles, transformations and comments, read as flat records.
 * `format-edit.ts` changes them.
 */
import type { FoundFormat } from './compile-format.ts';
import type { Replacement } from './replacements.ts';
import type {
  FormatStyleModel,
  SectionLayoutModel,
  Separator,
  SeparatorChoices,
} from './scrformat-layouts.ts';
import { layoutText, readLayout } from './section-layout.ts';

/** One section layout, as a person sees it. */
export interface LayoutDesign {
  id: string;
  name: string;
  titles: boolean;
  metadata: boolean;
  synopsis: boolean;
  text: boolean;
  notes: boolean;
  titlePrefix: string;
  titleSuffix: string;
  /** The title's closing hashes come before its suffix. */
  suffixAfterHashes: boolean;
  /** Letter cases, as a format writes them: `Normal`, `Uppercase`, `SmallCaps`, `Lowercase`. */
  titleCase: string;
  prefixCase: string;
  suffixCase: string;
  runIn: boolean;
  /** A fixed number of hashes for a title; 0 goes by its level. */
  hashCount: number;
  prefix: string;
  prefixAfterTitle: boolean;
  suffix: string;
  suffixAfterSubdocuments: boolean;
  uppercasedWords: number;
  /** Replaces each empty line in the text. */
  blankLine: string;
  /** The layout has separators of its own, not the format's. */
  ownSeparators: boolean;
  separatorBefore: string;
  separatorBeforeText: string;
  separatorBetween: string;
  separatorBetweenText: string;
  separatorAfter: string;
  separatorAfterText: string;
}

/** One format style: what the compile writes around text in it. */
export interface StyleDesign {
  id: string;
  name: string;
  /** What it styles: `Para`, `Char` or `Para+Char`. */
  type: string;
  prefix: string;
  suffix: string;
  /** Written at the start of each line in the style. */
  paraPrefix: string;
  deleteText: boolean;
  /** Text in the style is the writer's own markup. */
  rawMarkup: boolean;
}

/** The format's default separators, for folders or for text. */
export interface SeparatorsDesign {
  before: string;
  beforeText: string;
  between: string;
  betweenText: string;
  after: string;
  afterText: string;
}

/** A compile format's design. */
export interface FormatDesign {
  name: string;
  layouts: LayoutDesign[];
  styles: StyleDesign[];
  folderSeparators: SeparatorsDesign;
  textSeparators: SeparatorsDesign;
  removeSmartPunctuation: boolean;
  usePandocSyntax: boolean;
  addClosingHashes: boolean;
  notesBeforeText: boolean;
  includeSubtitles: boolean;
  updateTitleLinks: boolean;
  /** The styles given MultiMarkdown meanings, by ID; empty for none. */
  blockQuoteStyle: string;
  codeBlockStyle: string;
  codeSpanStyle: string;
  captionStyle: string;
  annotationPrefix: string;
  annotationSuffix: string;
  /** How a kept comment is written, `<$lnk>` its text and `<$cmt>` the comment; empty for the default. */
  commentTemplate: string;
  replacements: Replacement[];
  metadata: { key: string; value: string }[];
}

/** Marks a separator that adds nothing after a layout's items. */
export const NO_SEPARATOR = 'None';

/** A separator's two parts, with no separator for an "after" one that is not used. */
function separatorParts(separator: Separator) {
  const off = separator.use === false;
  return { type: off ? NO_SEPARATOR : separator.type, text: separator.text };
}

function separatorsDesign({ before, between, afterOverride }: SeparatorChoices): SeparatorsDesign {
  const after = separatorParts(afterOverride);
  return {
    before: before.type,
    beforeText: before.text,
    between: between.type,
    betweenText: between.text,
    after: after.type,
    afterText: after.text,
  };
}

export const NORMAL_CASE = 'Normal';

export function layoutDesign(model: SectionLayoutModel): LayoutDesign {
  // A design has no use for the names of the styles a layout's formatting gives.
  const layout = readLayout(model, String);
  const { titles } = layout;
  const separators = separatorsDesign(
    model.separators ?? {
      before: { type: 'Single', text: '' },
      between: { type: 'Single', text: '' },
      afterOverride: { use: false, type: 'Single', text: '' },
    },
  );
  return {
    id: layout.id,
    name: layout.name,
    titles: layout.includeTitles,
    metadata: layout.includeMetadata,
    synopsis: layout.includeSynopsis,
    text: layout.includeText,
    notes: layout.includeNotes,
    titlePrefix: model.titles?.prefix?.text ?? '',
    titleSuffix: model.titles?.suffix?.text ?? '',
    suffixAfterHashes: titles.suffixAfterHashes,
    titleCase: model.titles?.titleCase ?? NORMAL_CASE,
    prefixCase: model.titles?.prefix?.case ?? NORMAL_CASE,
    suffixCase: model.titles?.suffix?.case ?? NORMAL_CASE,
    runIn: titles.runIn,
    hashCount: titles.hashCount ?? 0,
    prefix: layoutText(layout.prefixLines),
    prefixAfterTitle: layout.prefixAfterTitle,
    suffix: layoutText(layout.suffixLines),
    suffixAfterSubdocuments: layout.suffixAfterSubdocuments,
    uppercasedWords: layout.uppercasedWords,
    blankLine: layout.blankLineSeparator,
    ownSeparators: model.separators ? !model.separators.useDefault : false,
    separatorBefore: separators.before,
    separatorBeforeText: separators.beforeText,
    separatorBetween: separators.between,
    separatorBetweenText: separators.betweenText,
    separatorAfter: separators.after,
    separatorAfterText: separators.afterText,
  };
}

const styleDesign = (style: FormatStyleModel): StyleDesign => ({
  id: style.id,
  name: style.name,
  type: style.type,
  prefix: style.prefix ?? '',
  suffix: style.suffix ?? '',
  paraPrefix: style.paraPrefix ?? '',
  deleteText: style.deleteText === true,
  rawMarkup: style.rawMarkup === true,
});

/** A format's design, from its file. */
export function readFormatDesign({ model }: FoundFormat): FormatDesign {
  const { mmd, transformations, formattingOptions, separatorSettings } = model;
  const comments = model.footnotesAndComments?.comments;
  return {
    name: model.name,
    layouts: model.sectionLayouts.map(layoutDesign),
    styles: (model.styles ?? []).map(styleDesign),
    folderSeparators: separatorsDesign(separatorSettings.folderSeparators),
    textSeparators: separatorsDesign(separatorSettings.textSeparators),
    removeSmartPunctuation: transformations?.removeSmartPunctuation === true,
    usePandocSyntax: mmd?.usePandocSyntax === true,
    addClosingHashes: mmd?.addClosingHashesToTitles === true,
    notesBeforeText: formattingOptions?.notesBeforeText === true,
    includeSubtitles: formattingOptions?.includeSubtitles === true,
    updateTitleLinks: model.titleLinks?.updateLinksWithPrefixAndSuffix?.update === true,
    blockQuoteStyle: mmd?.blockQuoteStyleId ?? '',
    codeBlockStyle: mmd?.codeBlockStyleId ?? '',
    codeSpanStyle: mmd?.codeSpanId ?? '',
    captionStyle: mmd?.captionStyleId ?? '',
    annotationPrefix: comments?.annotationPrefix ?? '',
    annotationSuffix: comments?.annotationSuffix ?? '',
    commentTemplate: comments?.commentFormat?.use ? comments.commentFormat.template : '',
    replacements: model.replacements,
    metadata: (mmd?.metadata ?? []).flatMap(({ key, value, isProjectMetadataPlaceholder }) =>
      isProjectMetadataPlaceholder ? [] : [{ key: key ?? '', value }],
    ),
  };
}
