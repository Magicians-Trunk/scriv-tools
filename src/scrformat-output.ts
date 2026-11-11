/**
 * A compile format's settings for outputs other than MultiMarkdown, as its `.scrformat` file holds
 * them: page layout, PDF, RTF, scripts, ebooks, statistics and footnote placement.  The library
 * keeps them so it can write the format back; the MultiMarkdown compile reads none of them.
 */
import { type DocumentText, rtfText } from './document.ts';
import { printSettings, type PrintSettings } from './scrivx.ts';
import { font, type FontChoice } from './scrformat-layouts.ts';
import {
  attribute,
  child,
  color,
  decimal,
  element,
  integer,
  optionalAttribute,
  optionalChild,
  optionalTextChild,
  string,
  text,
  textChild,
  yesNo,
} from './xml-codec.ts';

/** The page layout format's own settings: text that follows the compile, and widow control. */
export interface PageLayout {
  widowAndOrphanControl?: boolean;
  documentSuffix?: string;
  blankLineSeparator?: { state?: string; text: string };
  scriptwriting?: {
    pfAsDualDialogue?: boolean;
    moreAndContd?: { enabled: boolean; moreText: string; contdText: string };
    elements?: { character?: string; dialogue?: string; parenthetical?: string };
    avoidSplitSentences?: boolean;
  };
}

export interface Statistics {
  excludeFrontMatter: boolean;
  excludeBackMatter: boolean;
  countAllText?: boolean;
  countMainText: boolean;
  includeFootnotes?: boolean;
}

/** A header or footer: its text on the left, centre and right. */
export interface HeaderOrFooter {
  center?: string;
  left?: string;
  right?: string;
}

export interface HeadersAndFooters {
  footerDivider?: boolean;
  headerFont: FontChoice;
  footerFont: FontChoice;
  differentFirstPages?: boolean;
  countFirstScriptPage?: boolean;
  differentAlternatingPages?: boolean;
  differentNewPages?: boolean;
  firstRegularPage: number;
  omitFromSinglePages?: boolean;
  omitFromBlankPages?: boolean;
  standardHeader: HeaderOrFooter;
  standardFooter: HeaderOrFooter;
  firstPagesHeader: HeaderOrFooter;
  firstPagesFooter: HeaderOrFooter;
  rectoHeader: HeaderOrFooter;
  rectoFooter: HeaderOrFooter;
  newSectionHeader: HeaderOrFooter;
  newSectionFooter: HeaderOrFooter;
  backMatterHeader: HeaderOrFooter;
  backMatterFooter: HeaderOrFooter;
}

export interface PageSettings {
  useProjectSettings?: boolean;
  useDefaultPaperSize?: boolean;
  printSettings?: PrintSettings;
  margins: {
    units: string;
    respectPrinterBounds?: boolean;
    top: number;
    bottom: number;
    left: number;
    right: number;
    headerMargin?: number;
    footerMargin?: number;
  };
  headersAndFooters: HeadersAndFooters;
}

export interface PrintPdf {
  colorHyperlinks?: boolean;
  optimizeForPrintOnDemand?: boolean;
  generatePdfOutline?: boolean;
  internalLinkColor: number[];
  convertPdfToPdfX3?: boolean;
}

export interface RtfSettings {
  includeStyles: boolean;
  columns: { location?: string; number?: number; twipsBetween?: number };
  formatHyperlinks?: boolean;
  addScriptElementStyles?: boolean;
}

export interface ScriptFormats {
  breakDialogueAndActionAtSentences: boolean;
  includeRevisionColors: boolean;
  summaryFont: FontChoice;
  scriptNoteFont: FontChoice;
}

export interface EbookSettings {
  baseFormat: DocumentText;
  css?: { source: string; text: string };
  cssStylesFromDirectFormatting?: boolean;
  endnotesTitle: string;
  equationsAsMathMl: boolean;
  headIndents?: {
    flattenNew?: boolean;
    flattenAfterHeadings?: boolean;
    flattenAfterSeparators?: boolean;
    flattenAfterBlankLines?: boolean;
  };
  tablesAndLists: {
    tableStyle: string;
    epubListStyle: string;
    kindleListStyle: string;
    epubBulletStyle: string;
    kindleBulletStyle: string;
  };
  scriptSettings: { hasScriptFormatting: boolean; css: string };
  pandocSettings: { version: number };
}

/** How footnotes and endnotes are placed and numbered on the page. */
export interface FootnoteSettings {
  font: FontChoice;
  indentMatchesText?: boolean;
  footnotesUseSingleLineSpacing?: boolean;
  endnotesUseSingleLineSpacing?: boolean;
  dividerStyle: string;
  footnoteStyle: string;
  endnoteStyle: string;
  usePeriodSpaceStyle?: boolean;
  reduceMarkerSize?: boolean;
  numbering?: string;
  separator: boolean;
  endnotesArrangement: {
    placement: string;
    sectionGrouping: { group?: boolean; font: FontChoice };
  };
  footnotesStyleId?: string;
  avoidWidowsAndOrphans?: boolean;
  canSplitAcrossPages?: boolean;
  keepAtBottomOfPage?: boolean;
  centerSingleLineFootnotes?: boolean;
  inlinePlainText: { footnotePrefix: string; footnoteSuffix: string };
}

/** A string held as CDATA. */
const cdata = (name: string) => textChild(name, string, true);

export const pageLayout = element<PageLayout>('Layout', {
  widowAndOrphanControl: optionalTextChild('WidowAndOrphanControl', yesNo),
  documentSuffix: optionalTextChild('DocumentSuffix', string, true),
  blankLineSeparator: optionalChild(
    element<{ state?: string; text: string }>('BlankLineSeparator', {
      state: optionalAttribute('State', string),
      text: text(string, true),
    }),
  ),
  scriptwriting: optionalChild(
    element<NonNullable<PageLayout['scriptwriting']>>('Scriptwriting', {
      pfAsDualDialogue: optionalTextChild('PFAsDualDialogue', yesNo),
      moreAndContd: optionalChild(
        element<{ enabled: boolean; moreText: string; contdText: string }>('MoreAndContd', {
          enabled: attribute('Enabled', yesNo),
          moreText: cdata('MoreText'),
          contdText: cdata('ContdText'),
        }),
      ),
      elements: optionalChild(
        element<{ character?: string; dialogue?: string; parenthetical?: string }>('Elements', {
          character: optionalTextChild('Character', string),
          dialogue: optionalTextChild('Dialogue', string),
          parenthetical: optionalTextChild('Parenthetical', string),
        }),
      ),
      avoidSplitSentences: optionalTextChild('AvoidSplitSentences', yesNo),
    }),
  ),
});

export const statistics = element<Statistics>('Statistics', {
  excludeFrontMatter: textChild('ExcludeFrontMatter', yesNo),
  excludeBackMatter: textChild('ExcludeBackMatter', yesNo),
  countAllText: optionalTextChild('CountAllText', yesNo),
  countMainText: textChild('CountMainText', yesNo),
  includeFootnotes: optionalTextChild('IncludeFootnotes', yesNo),
});

/** A header or footer, empty when it has nothing on any side. */
const headerOrFooter = (name: string) =>
  child(
    element<HeaderOrFooter>(name, {
      center: optionalTextChild('Center', string, true),
      left: optionalTextChild('Left', string, true),
      right: optionalTextChild('Right', string, true),
    }),
  );

const headersAndFooters = element<HeadersAndFooters>('HeadersAndFooters', {
  footerDivider: optionalAttribute('FooterDivider', yesNo),
  headerFont: child(font('HeaderFont')),
  footerFont: child(font('FooterFont')),
  differentFirstPages: optionalTextChild('DifferentFirstPages', yesNo),
  countFirstScriptPage: optionalTextChild('CountFirstScriptPage', yesNo),
  differentAlternatingPages: optionalTextChild('DifferentAlternatingPages', yesNo),
  differentNewPages: optionalTextChild('DifferentNewPages', yesNo),
  firstRegularPage: textChild('FirstRegularPage', integer),
  omitFromSinglePages: optionalTextChild('OmitFromSinglePages', yesNo),
  omitFromBlankPages: optionalTextChild('OmitFromBlankPages', yesNo),
  standardHeader: headerOrFooter('StandardHeader'),
  standardFooter: headerOrFooter('StandardFooter'),
  firstPagesHeader: headerOrFooter('FirstPagesHeader'),
  firstPagesFooter: headerOrFooter('FirstPagesFooter'),
  rectoHeader: headerOrFooter('RectoHeader'),
  rectoFooter: headerOrFooter('RectoFooter'),
  newSectionHeader: headerOrFooter('NewSectionHeader'),
  newSectionFooter: headerOrFooter('NewSectionFooter'),
  backMatterHeader: headerOrFooter('BackMatterHeader'),
  backMatterFooter: headerOrFooter('BackMatterFooter'),
});

export const pageSettings = element<PageSettings>('PageSettings', {
  useProjectSettings: optionalAttribute('UseProjectSettings', yesNo),
  useDefaultPaperSize: optionalAttribute('UseDefaultPaperSize', yesNo),
  printSettings: optionalChild(printSettings),
  margins: child(
    element<PageSettings['margins']>('Margins', {
      units: attribute('Units', string),
      respectPrinterBounds: optionalAttribute('RespectPrinterBounds', yesNo),
      top: textChild('Top', decimal),
      bottom: textChild('Bottom', decimal),
      left: textChild('Left', decimal),
      right: textChild('Right', decimal),
      headerMargin: optionalTextChild('HeaderMargin', decimal),
      footerMargin: optionalTextChild('FooterMargin', decimal),
    }),
  ),
  headersAndFooters: child(headersAndFooters),
});

export const printPdf = element<PrintPdf>('PrintPDF', {
  colorHyperlinks: optionalTextChild('ColorHyperlinks', yesNo),
  optimizeForPrintOnDemand: optionalTextChild('OptimizeForPrintOnDemand', yesNo),
  generatePdfOutline: optionalTextChild('GeneratePDFOutline', yesNo),
  internalLinkColor: textChild('InternalLinkColor', color),
  convertPdfToPdfX3: optionalTextChild('ConvertPDFToPDFX3', yesNo),
});

export const rtfSettings = element<RtfSettings>('RTF', {
  includeStyles: textChild('IncludeStyles', yesNo),
  columns: child(
    element<RtfSettings['columns']>('Columns', {
      location: optionalAttribute('Location', string),
      number: optionalAttribute('Number', integer),
      twipsBetween: optionalAttribute('TwipsBetween', integer),
    }),
  ),
  formatHyperlinks: optionalTextChild('FormatHyperlinks', yesNo),
  addScriptElementStyles: optionalTextChild('AddScriptElementStyles', yesNo),
});

export const scriptFormats = element<ScriptFormats>('ScriptFormats', {
  breakDialogueAndActionAtSentences: textChild('BreakDialogueAndActionAtSentences', yesNo),
  includeRevisionColors: textChild('IncludeRevisionColors', yesNo),
  summaryFont: child(font('SummaryFont')),
  scriptNoteFont: child(font('ScriptNoteFont')),
});

export const ebookSettings = element<EbookSettings>('EBookSettings', {
  baseFormat: textChild('BaseFormat', rtfText, true),
  css: optionalChild(
    element<{ source: string; text: string }>('CSS', {
      source: attribute('Source', string),
      text: text(string, true),
    }),
  ),
  cssStylesFromDirectFormatting: optionalTextChild('CSSStylesFromDirectFormatting', yesNo),
  endnotesTitle: textChild('EndnotesTitle', string),
  equationsAsMathMl: textChild('EquationsAsMathML', yesNo),
  headIndents: optionalChild(
    element<NonNullable<EbookSettings['headIndents']>>('HeadIndents', {
      flattenNew: optionalTextChild('FlattenNew', yesNo),
      flattenAfterHeadings: optionalTextChild('FlattenAfterHeadings', yesNo),
      flattenAfterSeparators: optionalTextChild('FlattenAfterSeparators', yesNo),
      flattenAfterBlankLines: optionalTextChild('FlattenAfterBlankLines', yesNo),
    }),
  ),
  tablesAndLists: child(
    element<EbookSettings['tablesAndLists']>('TablesAndLists', {
      tableStyle: textChild('TableStyle', string),
      epubListStyle: textChild('EpubListStyle', string),
      kindleListStyle: textChild('KindleListStyle', string),
      epubBulletStyle: textChild('EpubBulletStyle', string),
      kindleBulletStyle: textChild('KindleBulletStyle', string),
    }),
  ),
  scriptSettings: child(
    element<EbookSettings['scriptSettings']>('ScriptSettings', {
      hasScriptFormatting: attribute('HasScriptFormatting', yesNo),
      css: text(string, true),
    }),
  ),
  pandocSettings: child(
    element<{ version: number }>('PandocSettings', { version: textChild('Version', integer) }),
  ),
});

export const footnoteSettings = element<FootnoteSettings>('Footnotes', {
  font: child(font('Font')),
  indentMatchesText: optionalTextChild('IndentMatchesText', yesNo),
  footnotesUseSingleLineSpacing: optionalTextChild('FootnotesUseSingleLineSpacing', yesNo),
  endnotesUseSingleLineSpacing: optionalTextChild('EndnotesUseSingleLineSpacing', yesNo),
  dividerStyle: textChild('DividerStyle', string),
  footnoteStyle: textChild('FootnoteStyle', string),
  endnoteStyle: textChild('EndnoteStyle', string),
  usePeriodSpaceStyle: optionalTextChild('UsePeriodSpaceStyle', yesNo),
  reduceMarkerSize: optionalTextChild('ReduceMarkerSize', yesNo),
  numbering: optionalTextChild('Numbering', string),
  separator: textChild('Separator', yesNo),
  endnotesArrangement: child(
    element<FootnoteSettings['endnotesArrangement']>('EndnotesArrangement', {
      placement: textChild('Placement', string),
      sectionGrouping: child(
        element<FootnoteSettings['endnotesArrangement']['sectionGrouping']>('SectionGrouping', {
          group: optionalAttribute('Group', yesNo),
          font: child(font('Font')),
        }),
      ),
    }),
  ),
  footnotesStyleId: optionalTextChild('FootnotesStyleID', string),
  avoidWidowsAndOrphans: optionalTextChild('AvoidWidowsAndOrphans', yesNo),
  canSplitAcrossPages: optionalTextChild('CanSplitAcrossPages', yesNo),
  keepAtBottomOfPage: optionalTextChild('KeepAtBottomOfPage', yesNo),
  centerSingleLineFootnotes: optionalTextChild('CenterSingleLineFootnotes', yesNo),
  inlinePlainText: child(
    element<FootnoteSettings['inlinePlainText']>('InlinePlainText', {
      footnotePrefix: cdata('FootnotePrefix'),
      footnoteSuffix: cdata('FootnoteSuffix'),
    }),
  ),
});
