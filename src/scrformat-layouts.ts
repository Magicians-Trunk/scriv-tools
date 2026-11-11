/** A compile format's section layouts, separators and styles, as its `.scrformat` file holds them. */
import { type DocumentText, readDocumentText, rtfText } from './document.ts';
import {
  attribute,
  child,
  closedWhenEmpty,
  decimal,
  element,
  integer,
  optionalAttribute,
  optionalChild,
  optionalTextChild,
  string,
  text,
  type Value,
  yesNo,
} from './xml-codec.ts';

/** A separator: a single or double return, a page break, or custom text. */
export interface Separator {
  /** For an "after" separator: whether it is used, after a layout's items. */
  use?: boolean;
  type: string;
  /** A custom separator's text. */
  text: string;
}

export interface SeparatorChoices {
  before: Separator;
  between: Separator;
  afterOverride: Separator;
}

/** A layout's separators, which it may take from the format's defaults. */
export interface LayoutSeparators extends SeparatorChoices {
  useDefault: boolean;
}

/** What a layout includes of each item. */
export interface LayoutInclude {
  titles?: boolean;
  synopses?: boolean;
  metadata?: boolean;
  notes?: boolean;
  text?: boolean;
}

export interface LayoutTitles {
  titleCase?: string;
  runInHead?: boolean;
  /** A fixed number of MultiMarkdown hashes, in place of one per level. */
  mmdHashCount?: number;
  prefix?: { case?: string; text: string };
  /** The suffix, and whether the hashes close before it or after it. */
  suffix?: { case?: string; hashesInside?: boolean; text: string };
}

/**
 * A formatting sample: text in the layout's formatting, as RTF, and the format styles its style
 * markers number, when it has any (`[STYLES]id,…[/STYLES]` before the RTF).
 */
export interface FormattingSample {
  styleIds?: string[];
  document: DocumentText;
}

const SAMPLE = /^\[STYLES\]([^[]*)\[\/STYLES\]([\s\S]*)$/;

const sample: Value<FormattingSample> = {
  read: (raw) => {
    const styled = SAMPLE.exec(raw);
    if (!styled) return { document: readDocumentText(raw) };
    return { styleIds: styled[1]!.split(','), document: readDocumentText(styled[2]!) };
  },
  write: ({ styleIds, document }) => {
    const ids = styleIds === undefined ? '' : `[STYLES]${styleIds.join(',')}[/STYLES]`;
    return ids + rtfText.write(document);
  },
};

/** The formatting a layout gives each part of a section. */
export interface LayoutFormatting {
  override?: boolean;
  ebooksUseBaseFormatting?: boolean;
  flattenIndents?: string;
  title?: FormattingSample;
  titlePrefix?: FormattingSample;
  titleSuffix?: FormattingSample;
  metadata?: FormattingSample;
  synopsis?: FormattingSample;
  notes?: FormattingSample;
  text?: FormattingSample;
  subtitles?: FormattingSample;
  preserveUncommonAlignment?: boolean;
  preserveTabsAndIndents?: boolean;
}

/** Where a section starts on a printed page. */
export interface RectoVersoControl {
  sectionControl?: { type: string; on: boolean };
  nextSectionControl?: { type: string; on: boolean };
}

export interface SectionLayoutModel {
  name: string;
  id: string;
  include: LayoutInclude;
  rtfBookmark?: boolean;
  pagePadding?: number;
  /** Replaces each empty line in the text, unless in a style when `skipStyles`. */
  blankLineSeparator?: { skipStyles?: boolean; text: string };
  uppercasedFirstWords?: number;
  titles?: LayoutTitles;
  rectoVersoControl?: RectoVersoControl;
  /** The prefix, as RTF, and whether it goes after the title. */
  prefix?: { afterTitle?: boolean; document: DocumentText };
  cssClassName?: string;
  /** The suffix, as RTF, and whether it waits for the item's subdocuments. */
  suffix?: { afterSubdocs?: boolean; document: DocumentText };
  formatting?: LayoutFormatting;
  separators?: LayoutSeparators;
}

/** A format style: its formatting, and what the compile writes around text in it. */
export interface FormatStyleModel {
  name: string;
  id: string;
  type: string;
  fontChange?: string;
  format?: DocumentText;
  removeFirstIndent?: boolean;
  overrideName?: string;
  rawMarkup?: boolean;
  deleteText?: boolean;
  removeNextIndent?: boolean;
  prefix?: string;
  suffix?: string;
  /** Written at the start of each line in the style. */
  paraPrefix?: string;
}

/** A separator element: its type, and a custom separator's text, as CDATA. */
const separator = (name: string) =>
  element<Separator>(name, {
    use: optionalAttribute('Use', yesNo),
    type: attribute('Type', string),
    text: closedWhenEmpty(string, true),
  });

export const separatorChoices = {
  before: child(separator('Before')),
  between: child(separator('Between')),
  afterOverride: child(separator('AfterOverride')),
};

const control = (name: string) =>
  element<{ type: string; on: boolean }>(name, {
    type: attribute('Type', string),
    on: text(yesNo),
  });

const formattingSample = (name: string) => optionalTextChild(name, sample, true);

export const sectionLayout = element<SectionLayoutModel>('Layout', {
  name: attribute('Name', string),
  id: attribute('ID', string),
  include: child(
    element<LayoutInclude>('Include', {
      titles: optionalAttribute('Titles', yesNo),
      synopses: optionalAttribute('Synopses', yesNo),
      metadata: optionalAttribute('MetaData', yesNo),
      notes: optionalAttribute('Notes', yesNo),
      text: optionalAttribute('Text', yesNo),
    }),
  ),
  rtfBookmark: optionalTextChild('RTFBookmark', yesNo),
  pagePadding: optionalTextChild('PagePadding', integer),
  blankLineSeparator: optionalChild(
    element<{ skipStyles?: boolean; text: string }>('BlankLineSeparator', {
      skipStyles: optionalAttribute('SkipStyles', yesNo),
      text: text(string, 'cdataUnlessEmpty'),
    }),
  ),
  uppercasedFirstWords: optionalTextChild('UppercasedFirstWords', integer),
  titles: optionalChild(
    element<LayoutTitles>('Titles', {
      titleCase: optionalTextChild('TitleCase', string),
      runInHead: optionalTextChild('RunInHead', yesNo),
      mmdHashCount: optionalTextChild('MMDHashCount', integer),
      prefix: optionalChild(
        element<{ case?: string; text: string }>('Prefix', {
          case: optionalAttribute('Case', string),
          text: text(string, true),
        }),
      ),
      suffix: optionalChild(
        element<{ case?: string; hashesInside?: boolean; text: string }>('Suffix', {
          case: optionalAttribute('Case', string),
          hashesInside: optionalAttribute('HashesInside', yesNo),
          text: text(string, true),
        }),
      ),
    }),
  ),
  rectoVersoControl: optionalChild(
    element<RectoVersoControl>('RectoVersoControl', {
      sectionControl: optionalChild(control('SectionControl')),
      nextSectionControl: optionalChild(control('NextSectionControl')),
    }),
  ),
  prefix: optionalChild(
    element<{ afterTitle?: boolean; document: DocumentText }>('Prefix', {
      afterTitle: optionalAttribute('AfterTitle', yesNo),
      document: text(rtfText, true),
    }),
  ),
  cssClassName: optionalTextChild('CSSClassName', string),
  suffix: optionalChild(
    element<{ afterSubdocs?: boolean; document: DocumentText }>('Suffix', {
      afterSubdocs: optionalAttribute('AfterSubdocs', yesNo),
      document: text(rtfText, true),
    }),
  ),
  formatting: optionalChild(
    element<LayoutFormatting>('Formatting', {
      override: optionalAttribute('Override', yesNo),
      ebooksUseBaseFormatting: optionalAttribute('EbooksUseBaseFormatting', yesNo),
      flattenIndents: optionalAttribute('FlattenIndents', string),
      title: formattingSample('Title'),
      titlePrefix: formattingSample('TitlePrefix'),
      titleSuffix: formattingSample('TitleSuffix'),
      metadata: formattingSample('MetaData'),
      synopsis: formattingSample('Synopsis'),
      notes: formattingSample('Notes'),
      text: formattingSample('Text'),
      subtitles: formattingSample('Subtitles'),
      preserveUncommonAlignment: optionalTextChild('PreserveUncommonAlignment', yesNo),
      preserveTabsAndIndents: optionalTextChild('PreserveTabsAndIndents', yesNo),
    }),
  ),
  separators: optionalChild(
    element<LayoutSeparators>('Separators', {
      useDefault: attribute('UseDefault', yesNo),
      ...separatorChoices,
    }),
  ),
});

export const formatStyle = element<FormatStyleModel>('Style', {
  name: attribute('Name', string),
  id: attribute('ID', string),
  type: attribute('Type', string),
  fontChange: optionalAttribute('FontChange', string),
  format: optionalTextChild('Format', rtfText, true),
  removeFirstIndent: optionalTextChild('RemoveFirstIndent', yesNo),
  overrideName: optionalTextChild('OverrideName', string),
  rawMarkup: optionalTextChild('RawMarkup', yesNo),
  deleteText: optionalTextChild('DeleteText', yesNo),
  removeNextIndent: optionalTextChild('RemoveNextIndent', yesNo),
  prefix: optionalTextChild('Prefix', string, true),
  suffix: optionalTextChild('Suffix', string, true),
  paraPrefix: optionalTextChild('ParaPrefix', string, true),
});

/** A font a setting overrides with, by its PostScript name, and its size in points. */
export interface FontChoice {
  size: number;
  override?: boolean;
  name: string;
}

export const font = (name: string) =>
  element<FontChoice>(name, {
    size: attribute('Size', decimal),
    override: optionalAttribute('Override', yesNo),
    name: text(string),
  });
