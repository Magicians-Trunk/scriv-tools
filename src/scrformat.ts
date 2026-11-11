/**
 * A compile format, its `.scrformat` file read whole: what it compiles to, its section layouts,
 * separators and styles, the MultiMarkdown and comment settings, and its settings for other
 * outputs, so that it can be written back as Scrivener writes it.
 */
import { type Replacement, replacements } from './replacements.ts';
import {
  type FormatStyleModel,
  font,
  type FontChoice,
  formatStyle,
  type SectionLayoutModel,
  sectionLayout,
  type SeparatorChoices,
  separatorChoices,
} from './scrformat-layouts.ts';
import {
  ebookSettings,
  type EbookSettings,
  footnoteSettings,
  type FootnoteSettings,
  pageLayout,
  type PageLayout,
  pageSettings,
  type PageSettings,
  printPdf,
  type PrintPdf,
  rtfSettings,
  type RtfSettings,
  scriptFormats,
  type ScriptFormats,
  statistics,
  type Statistics,
} from './scrformat-output.ts';
import {
  attribute,
  child,
  closedWhenEmpty,
  type Codec,
  decimal,
  element,
  integer,
  list,
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

/** A MultiMarkdown metadata entry, or where the project's own metadata goes. */
export interface FormatMetadataValue {
  isProjectMetadataPlaceholder?: boolean;
  key?: string;
  value: string;
}

/** The MultiMarkdown settings: metadata, the styles given MultiMarkdown meanings, LaTeX. */
export interface MmdSettings {
  metadata: FormatMetadataValue[];
  blockQuoteStyleId?: string;
  codeBlockStyleId?: string;
  codeSpanId?: string;
  captionStyleId?: string;
  pageTitleStyleId?: string;
  addClosingHashesToTitles?: boolean;
  latexDocumentClass?: string;
  latexHeader?: string;
  usePandocSyntax?: boolean;
  commandLineCustom?: {
    postProcess?: boolean;
    deleteFile?: boolean;
    deleteSupportingFiles?: boolean;
    path?: string;
    args?: string;
  };
  latexBeginDocument?: string;
  latexFooter?: string;
}

/** How annotations and linked comments are written. */
export interface CommentSettings {
  annotationsRtfType?: string;
  annotationPrefix: string;
  annotationSuffix: string;
  /** The template for a kept comment, `<$lnk>` its text and `<$cmt>` the comment, when used. */
  commentFormat?: { use: boolean; template: string };
}

export interface Transformations {
  removeSmartPunctuation?: boolean;
  plainTextConversion?: { state: string; conversion: string };
  underlineHyperlinks?: boolean;
  convertItalicsToUnderline?: boolean;
  outlineIndent?: { state: string; indent: string };
}

/** A script run over the compiled file, or a command. */
export interface PostProcessing {
  enabled: boolean;
  type?: string;
  deleteFile?: boolean;
  shell?: string;
  script?: string;
  path?: string;
  args?: string;
  env?: string;
}

/** Everything in a `.scrformat` file. */
export interface Scrformat {
  name: string;
  id: string;
  supportedTypes: string[];
  sectionLayouts: SectionLayoutModel[];
  formattingOptions?: { notesBeforeText: boolean; includeSubtitles: boolean };
  separatorSettings: {
    folderSeparators: SeparatorChoices;
    textSeparators: SeparatorChoices;
    font?: FontChoice;
  };
  styles?: FormatStyleModel[];
  titleLinks?: {
    updateLinksWithPrefixAndSuffix?: { prefixOnly?: boolean; update: boolean };
    prefixSeparator?: { override?: boolean; newlinesOnly?: boolean; text: string };
  };
  pageLayout?: PageLayout;
  transformations?: Transformations;
  replacements: Replacement[];
  statistics?: Statistics;
  tables?: { convertToImages: { maxWidth?: number; convert: boolean } };
  footnotesAndComments?: { footnotes?: FootnoteSettings; comments?: CommentSettings };
  pageSettings?: PageSettings;
  printPdf?: PrintPdf;
  rtf?: RtfSettings;
  scriptFormats?: ScriptFormats;
  html?: { useCenteredBodyTable: { width?: number; use: boolean }; fullPageImageWidth: number };
  plainText?: { extension: string };
  mmd?: MmdSettings;
  ebook?: EbookSettings;
  postProcessing?: PostProcessing;
}

const mmd = element<MmdSettings>('MMD', {
  metadata: list(
    'MetaData',
    element<FormatMetadataValue>('Value', {
      isProjectMetadataPlaceholder: optionalAttribute('IsProjectMetaDataPlaceholder', yesNo),
      key: optionalAttribute('Key', string),
      value: closedWhenEmpty(string, true),
    }),
  ),
  blockQuoteStyleId: optionalTextChild('BlockQuoteStyleID', string),
  codeBlockStyleId: optionalTextChild('CodeBlockStyleID', string),
  codeSpanId: optionalTextChild('CodeSpanID', string),
  captionStyleId: optionalTextChild('CaptionStyleID', string),
  pageTitleStyleId: optionalTextChild('PageTitleStyleID', string),
  addClosingHashesToTitles: optionalTextChild('AddClosingHashesToTitles', yesNo),
  latexDocumentClass: optionalTextChild('LaTeXDocumentClass', string),
  latexHeader: optionalTextChild('LaTeXHeader', string, true),
  usePandocSyntax: optionalTextChild('UsePandocSyntax', yesNo),
  commandLineCustom: optionalChild(
    element<NonNullable<MmdSettings['commandLineCustom']>>('CommandLineCustom', {
      postProcess: optionalAttribute('PostProcess', yesNo),
      deleteFile: optionalAttribute('DeleteFile', yesNo),
      deleteSupportingFiles: optionalAttribute('DeleteSupportingFiles', yesNo),
      path: optionalTextChild('Path', string),
      args: optionalTextChild('Args', string),
    }),
  ),
  latexBeginDocument: optionalTextChild('LaTeXBeginDocument', string, true),
  latexFooter: optionalTextChild('LaTeXFooter', string, true),
});

const comments = element<CommentSettings>('Comments', {
  annotationsRtfType: optionalTextChild('AnnotationsRTFType', string),
  annotationPrefix: textChild('AnnotationPrefix', string, true),
  annotationSuffix: textChild('AnnotationSuffix', string, true),
  commentFormat: optionalChild(
    element<{ use: boolean; template: string }>('CommentFormatString', {
      use: attribute('Use', yesNo),
      template: text(string),
    }),
  ),
});

const transformations = element<Transformations>('Transformations', {
  removeSmartPunctuation: optionalTextChild('RemoveSmartPunctuation', yesNo),
  plainTextConversion: optionalChild(
    element<{ state: string; conversion: string }>('PlainTextConversion', {
      state: attribute('State', string),
      conversion: closedWhenEmpty(string),
    }),
  ),
  underlineHyperlinks: optionalTextChild('UnderlineHyperlinks', yesNo),
  convertItalicsToUnderline: optionalTextChild('ConvertItalicsToUnderline', yesNo),
  outlineIndent: optionalChild(
    element<{ state: string; indent: string }>('OutlineIndent', {
      state: attribute('State', string),
      indent: text(string),
    }),
  ),
});

const postProcessing = element<PostProcessing>('PostProcessing', {
  enabled: attribute('Enabled', yesNo),
  type: optionalAttribute('Type', string),
  deleteFile: optionalAttribute('DeleteFile', yesNo),
  shell: optionalTextChild('Shell', string),
  script: optionalTextChild('Script', string, true),
  path: optionalTextChild('Path', string),
  args: optionalTextChild('Args', string),
  env: optionalTextChild('Env', string),
});

export const scrformat: Codec<Scrformat> = element<Scrformat>('CompileFormat', {
  name: attribute('Name', string),
  id: attribute('ID', string),
  supportedTypes: list('SupportedTypes', textElement('Type', string)),
  sectionLayouts: list('SectionLayouts', sectionLayout),
  formattingOptions: optionalChild(
    element<{ notesBeforeText: boolean; includeSubtitles: boolean }>('FormattingOptions', {
      notesBeforeText: textChild('NotesBeforeText', yesNo),
      includeSubtitles: textChild('IncludeSubtitles', yesNo),
    }),
  ),
  separatorSettings: child(
    element<Scrformat['separatorSettings']>('SeparatorSettings', {
      folderSeparators: child(element<SeparatorChoices>('FolderSeparators', separatorChoices)),
      textSeparators: child(element<SeparatorChoices>('TextSeparators', separatorChoices)),
      font: optionalChild(font('Font')),
    }),
  ),
  styles: optionalList('Styles', formatStyle),
  titleLinks: optionalChild(
    element<NonNullable<Scrformat['titleLinks']>>('TitleLinks', {
      updateLinksWithPrefixAndSuffix: optionalChild(
        element<{ prefixOnly?: boolean; update: boolean }>('UpdateLinksWithPrefixAndSuffix', {
          prefixOnly: optionalAttribute('PrefixOnly', yesNo),
          update: text(yesNo),
        }),
      ),
      prefixSeparator: optionalChild(
        element<{ override?: boolean; newlinesOnly?: boolean; text: string }>('PrefixSeparator', {
          override: optionalAttribute('Override', yesNo),
          newlinesOnly: optionalAttribute('NewlinesOnly', yesNo),
          text: text(string, true),
        }),
      ),
    }),
  ),
  pageLayout: optionalChild(pageLayout),
  transformations: optionalChild(transformations),
  replacements,
  statistics: optionalChild(statistics),
  tables: optionalChild(
    element<NonNullable<Scrformat['tables']>>('Tables', {
      convertToImages: child(
        element<{ maxWidth?: number; convert: boolean }>('ConvertToImages', {
          maxWidth: optionalAttribute('MaxWidth', decimal),
          convert: text(yesNo),
        }),
      ),
    }),
  ),
  footnotesAndComments: optionalChild(
    element<NonNullable<Scrformat['footnotesAndComments']>>('FootnotesAndComments', {
      footnotes: optionalChild(footnoteSettings),
      comments: optionalChild(comments),
    }),
  ),
  pageSettings: optionalChild(pageSettings),
  printPdf: optionalChild(printPdf),
  rtf: optionalChild(rtfSettings),
  scriptFormats: optionalChild(scriptFormats),
  html: optionalChild(
    element<NonNullable<Scrformat['html']>>('HTML', {
      useCenteredBodyTable: child(
        element<{ width?: number; use: boolean }>('UseCenteredBodyTable', {
          width: optionalAttribute('Width', integer),
          use: text(yesNo),
        }),
      ),
      fullPageImageWidth: textChild('FullPageImageWidth', integer),
    }),
  ),
  plainText: optionalChild(
    element<{ extension: string }>('PlainText', { extension: textChild('Extension', string) }),
  ),
  mmd: optionalChild(mmd),
  ebook: optionalChild(ebookSettings),
  postProcessing: optionalChild(postProcessing),
});

/** A compile format as its `.scrformat` file, as Scrivener writes it. */
export function writeScrformat(format: Scrformat): string {
  return writeXml(scrformat.write(format));
}
