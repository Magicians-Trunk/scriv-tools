import { documentLines, type DocumentText } from './document.ts';
import { type StyleMarker, markupText } from './markup.ts';
import type {
  LayoutFormatting,
  LayoutTitles,
  SectionLayoutModel,
  Separator,
  SeparatorChoices,
} from './scrformat-layouts.ts';
import { parsePlaceholders, placeholderText } from './placeholder-syntax.ts';
import { UnsupportedError } from './unsupported.ts';

/** An empty line between sections, and a page break, in MultiMarkdown. */
export const BLANK_LINE = '\n\n';

/** A page break between sections, in MultiMarkdown. */
export const PAGE_BREAK = '\n\n----\n\n';

/** The text placed between two sections. */
export interface Separators {
  before: string;
  between: string;
  /** Replaces whichever separator follows the item, when set. */
  after?: string;
}

/** How a layout writes titles. */
/** The letter case a title takes.  Markdown has no small capitals: they come out as capitals. */
export type LetterCase = 'Normal' | 'Uppercase' | 'Lowercase';

export interface TitleOptions {
  prefix: string;
  suffix: string;
  /** The suffix goes after the closing hashes instead of before them. */
  suffixAfterHashes: boolean;
  /** A fixed number of hashes, instead of one per level.  With none, the title is not a heading. */
  hashCount?: number;
  titleCase: LetterCase;
  /** The title runs into the text on the same line. */
  runIn: boolean;
  /** The character style the layout's overridden formatting gives the suffix, by name. */
  suffixStyle?: string;
}

export interface SectionLayout {
  id: string;
  name: string;
  includeTitles: boolean;
  includeText: boolean;
  includeSynopsis: boolean;
  includeNotes: boolean;
  includeMetadata: boolean;
  titles: TitleOptions;
  /** The prefix and suffix, each paragraph's text as a line. */
  prefixLines: string[];
  suffixLines: string[];
  prefixAfterTitle: boolean;
  suffixAfterSubdocuments: boolean;
  /** The text's first words, set in capitals. */
  uppercasedWords: number;
  /** Replaces each empty line in the text, when set. */
  blankLineSeparator: string;
  /** The layout's own separators.  Missing when it uses the format's defaults. */
  separators?: Separators;
  /** The paragraph style the layout's overridden formatting gives the text, by name. */
  textStyle?: string;
}

/** The layout the compile reads from a format's layout, its styles named by `styleName`. */
export function readLayout(
  layout: SectionLayoutModel,
  styleName: (id: string) => string,
): SectionLayout {
  const { name, include, prefix, suffix, separators } = layout;
  const result: SectionLayout = {
    id: layout.id,
    name,
    includeTitles: include.titles === true,
    includeText: include.text === true,
    includeSynopsis: include.synopses === true,
    includeNotes: include.notes === true,
    includeMetadata: include.metadata === true,
    titles: readTitles(layout.titles, name),
    prefixLines: prefix ? plainLines(prefix.document) : [],
    suffixLines: suffix ? plainLines(suffix.document) : [],
    prefixAfterTitle: prefix?.afterTitle === true,
    suffixAfterSubdocuments: suffix?.afterSubdocs === true,
    uppercasedWords: layout.uppercasedFirstWords ?? 0,
    blankLineSeparator: layout.blankLineSeparator?.text ?? '',
  };
  if (separators && !separators.useDefault) result.separators = readSeparators(separators);
  const styles = overriddenStyles(layout.formatting, name, styleName);
  if (styles.Text !== undefined) result.textStyle = styles.Text;
  if (styles.TitleSuffix !== undefined) result.titles.suffixStyle = styles.TitleSuffix;
  return result;
}

/** Each formatting sample a layout has, and the part of the section it formats. */
const SAMPLE_PARTS: [keyof LayoutFormatting, string][] = [
  ['title', 'Title'],
  ['titlePrefix', 'TitlePrefix'],
  ['titleSuffix', 'TitleSuffix'],
  ['metadata', 'MetaData'],
  ['synopsis', 'Synopsis'],
  ['notes', 'Notes'],
  ['text', 'Text'],
  ['subtitles', 'Subtitles'],
];

/**
 * When a layout overrides formatting, each part's sample text carries the format styles it
 * applies, whose markers number the sample's list of style IDs.  Only fonts and sizes matter
 * otherwise, which MultiMarkdown does not write.  A paragraph style on the text sample styles the
 * item's text, and a character style on the title suffix sample styles the suffix; other styled
 * samples are not worked out yet.
 */
function overriddenStyles(
  formatting: LayoutFormatting | undefined,
  layout: string,
  styleName: (id: string) => string,
): Partial<Record<'Text' | 'TitleSuffix', string>> {
  const styles: Partial<Record<'Text' | 'TitleSuffix', string>> = {};
  if (!formatting?.override) return styles;
  for (const [key, part] of SAMPLE_PARTS) {
    const sample = formatting[key];
    if (typeof sample !== 'object' || !sample.styleIds) continue;
    const ids = sample.styleIds;
    const opened = documentLines(sample.document).flatMap((nodes) =>
      nodes.filter((node): node is StyleMarker => node.kind === 'style' && !node.closing),
    );
    // Each marker numbers a style in the sample's list of IDs.
    const names = opened.map((marker) => styleName(ids[marker.index] ?? ''));
    const scope = opened.length === 1 ? opened[0]!.scope : undefined;
    if (part === 'Text' && scope === 'paragraph') styles.Text = names[0];
    else if (part === 'TitleSuffix' && scope === 'character') styles.TitleSuffix = names[0];
    else {
      throw new UnsupportedError(
        `section layout "${layout}" ${part} formatting in ${names.join(', ')}`,
      );
    }
  }
  return styles;
}

/** The case a layout names, as Markdown can write it. */
function letterCase(written: string | undefined, layout: string): LetterCase {
  if (written === undefined || written === 'Normal') return 'Normal';
  if (written === 'Uppercase' || written === 'SmallCaps') return 'Uppercase';
  if (written === 'Lowercase') return written;
  throw new UnsupportedError(`section layout "${layout}" title case ${written}`);
}

/** Text in a letter case. */
export function inCase(text: string, letters: LetterCase): string {
  if (letters === 'Uppercase') return text.toUpperCase();
  return letters === 'Lowercase' ? text.toLowerCase() : text;
}

/** A title's prefix or suffix in its case: what placeholders come to is theirs to say. */
function casedText(text: string | undefined = '', written: string | undefined, layout: string) {
  const letters = letterCase(written, layout);
  if (letters === 'Normal') return text;
  return parsePlaceholders(text)
    .map((piece) => (piece.kind === 'text' ? inCase(piece.text, letters) : placeholderText(piece)))
    .join('');
}

function readTitles(titles: LayoutTitles | undefined, layout: string): TitleOptions {
  const options: TitleOptions = {
    prefix: casedText(titles?.prefix?.text, titles?.prefix?.case, layout),
    suffix: casedText(titles?.suffix?.text, titles?.suffix?.case, layout),
    suffixAfterHashes: titles?.suffix?.hashesInside === true,
    titleCase: letterCase(titles?.titleCase, layout),
    runIn: titles?.runInHead === true,
  };
  if (titles?.mmdHashCount !== undefined) options.hashCount = titles.mmdHashCount;
  return options;
}

/** A layout's prefix or suffix as text. */
export const layoutText = (lines: string[]) => lines.join('\n');

/** The prefix when nothing follows it in the section: without its closing empty paragraphs. */
export function prefixAlone(prefixLines: string[]): { text: string; droppedBreaks: number } {
  const lines = [...prefixLines];
  while (lines.at(-1) === '') lines.pop();
  return { text: layoutText(lines), droppedBreaks: prefixLines.length - lines.length };
}

/**
 * A suffix after subdocuments, as its leading empty paragraphs (as line breaks) and the rest.  A
 * suffix of nothing but empty paragraphs is a line break fewer than it has paragraphs.
 */
export function lateSuffixParts(lines: string[]): { breaks: number; rest: string } {
  const leading = lines.findIndex((line) => line !== '');
  const breaks = leading === -1 ? Math.max(0, lines.length - 1) : leading;
  return { breaks, rest: layoutText(lines.slice(breaks)) };
}

/** Each line's plain text, of a layout's prefix or suffix. */
function plainLines(document: DocumentText): string[] {
  return documentLines(document).map((nodes) => {
    const kept = nodes.find(
      (node) => node.kind !== 'text' && node.kind !== 'break' && node.kind !== 'placeholder',
    );
    if (kept) throw new UnsupportedError(`a section layout prefix or suffix with a ${kept.kind}`);
    return markupText(nodes);
  });
}

/**
 * A separator's text.  In MultiMarkdown a single return still leaves an empty line, a page break
 * is a `----` line, and custom text sits on its own line.
 */
function separatorText({ type, text }: Separator): string {
  if (type === 'Single' || type === 'Double') return BLANK_LINE;
  if (type === 'PageBreak') return PAGE_BREAK;
  if (type === 'Custom') return `\n${text}\n`;
  throw new UnsupportedError(`separator type ${type}`);
}

/** The separators the compile writes, from a layout's or the format's choices. */
export function readSeparators(choices: SeparatorChoices): Separators {
  const separators: Separators = {
    before: separatorText(choices.before),
    between: separatorText(choices.between),
  };
  if (choices.afterOverride.use) separators.after = separatorText(choices.afterOverride);
  return separators;
}
