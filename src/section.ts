import { type BinderItem, keepsText } from './binder-item.ts';
import { labelName, type Project, statusName } from './project.ts';
import { type CompileFormat } from './compile-format.ts';
import type { CompileInput } from './model.ts';
import {
  inCase,
  BLANK_LINE,
  layoutText,
  PAGE_BREAK,
  prefixAlone,
  type SectionLayout,
} from './section-layout.ts';
import { type Rendered, renderText, type TextLayout } from './document-text.ts';
import { UnsupportedError } from './unsupported.ts';
import { stampDate, usDate } from './dates.ts';
import { BoundText, type HeadingPart } from './bound-text.ts';
/**
 * The title suffix, in the character style the layout's formatting gives it.  Like Scrivener, the
 * style starts after the suffix's leading spaces.
 */
function titleSuffix(layout: SectionLayout, format: CompileFormat): string {
  const { suffix, suffixStyle } = layout.titles;
  if (suffixStyle === undefined) return suffix;
  const style = format.styles.get(suffixStyle);
  const lead = /^\s*/.exec(suffix)![0];
  const styled = suffix.slice(lead.length);
  return styled && style ? `${lead}${style.prefix}${styled}${style.suffix}` : suffix;
}

/** One compiled binder item. */
export interface Entry {
  item: BinderItem;
  level: number;
  layout?: SectionLayout;
  /** The item's compiled text: before replacements and placeholders, then after. */
  text: BoundText;
  /** The names of the images its text refers to. */
  images: string[];
  /** The hierarchical numbering placeholder the item uses, which sets its number. */
  numbering?: string;
  /** When the item's text ends with a list, the line breaks after it. */
  breaksAfterList?: number;
  /** The item's text ends with a footnote. */
  endsWithNote?: boolean;
  /** The empty lines its prefix dropped, having nothing after it. */
  droppedBreaks?: number;
}

/**
 * A compiled item, its text evaluated, but not yet written; and the layout's suffix, when it
 * waits for the item's subdocuments: its leading line breaks, and the rest, evaluated.
 */
export interface PreparedSection extends Entry {
  lateSuffix?: { breaks: number; rest: BoundText };
}

/** A section: its text, never nothing, with its footnotes and what it leaves as written. */
export interface RenderedSection extends Rendered {
  text: BoundText;
  /** The empty lines a prefix with nothing after it dropped, which a custom separator keeps. */
  droppedBreaks?: number;
}

/**
 * An item's section: the layout's prefix, its title, then its metadata, synopsis, notes and text,
 * then the layout's suffix (unless it waits for the item's subdocuments).  Its footnotes are
 * numbered from after the compile's `notesBefore`.
 */
export function sectionContent(
  input: CompileInput,
  item: BinderItem,
  level: number,
  layout: SectionLayout | undefined,
  notesBefore: number,
): RenderedSection {
  if (!layout) {
    const rendered = itemText(input, item, {}, notesBefore);
    return { ...rendered, text: rendered.text ?? BoundText.of('') };
  }
  const included = sectionParts(input, item, layout, notesBefore);
  const { notes, leftAsWritten } = included;
  const parts = BoundText.join(included.parts, '\n\n');
  // A part counts though it writes nothing, as text a style deletes does.
  const hasParts = included.parts.length > 0;
  const { format } = input;
  // The layout's own text has its placeholders evaluated after the replacements.
  const suffix = BoundText.deferred(
    layout.suffixAfterSubdocuments ? '' : layoutText(layout.suffixLines),
  );
  const titles = layout.titles;
  // Without titles, a title prefix or suffix still makes a heading, with no title in it.
  const decorated = titles.prefix !== '' || titles.suffix !== '';
  const title = layout.includeTitles ? item.title : decorated ? '' : undefined;
  // A prefix with nothing after it in the section ends at its last written paragraph.
  const titleFollows = title !== undefined && !layout.prefixAfterTitle;
  const alone = !titleFollows && !hasParts && suffix.text === '';
  const { text: prefixText, droppedBreaks } = alone
    ? prefixAlone(layout.prefixLines)
    : { text: layoutText(layout.prefixLines), droppedBreaks: 0 };
  const prefix = BoundText.deferred(prefixText);
  const section = (written: (string | BoundText)[]): RenderedSection => ({
    text: BoundText.join(written),
    notes,
    leftAsWritten,
    ...(droppedBreaks > 0 ? { droppedBreaks } : {}),
  });
  if (title === undefined) return section([prefix, parts, suffix]);
  // Each part of the heading is marked, for links to the section to name it.
  const part = (content: BoundText, name: HeadingPart['part']) =>
    BoundText.headingPart(content, item.id, name);
  const titleEnd = part(BoundText.deferred(titleSuffix(layout, format)), 'suffix');
  const named = BoundText.join([
    part(BoundText.deferred(titles.prefix), 'prefix'),
    part(BoundText.of(inCase(title, titles.titleCase)), 'title'),
  ]);
  if (titles.runIn) return section([prefix, named, titleEnd, parts, suffix]);
  const hashes = '#'.repeat(titles.hashCount ?? level);
  const inside = titles.suffixAfterHashes ? named : BoundText.join([named, titleEnd]);
  const heading = hashes
    ? BoundText.join([`${hashes} `, inside, format.addClosingHashes ? ` ${hashes}` : ''])
    : inside;
  const line = titles.suffixAfterHashes ? BoundText.join([heading, titleEnd]) : heading;
  // A title without hashes is not a heading, so the text follows on the next line.
  const gap = hashes ? '\n\n' : '\n';
  if (layout.prefixAfterTitle) {
    return section([line, hasParts || prefix.text ? gap : '', prefix, parts, suffix]);
  }
  return section([prefix, line, hasParts ? gap : '', parts, suffix]);
}

/**
 * The metadata, synopsis, notes and text a layout includes, in the format's order, leaving out
 * empty ones, and their footnotes and what they leave as written.  With subtitles on and more than
 * one of synopsis, notes and text in the layout, each is headed `**Synopsis**` and so on.
 */
function sectionParts(
  input: CompileInput,
  item: BinderItem,
  layout: SectionLayout,
  notesBefore: number,
): { parts: BoundText[]; notes: BoundText[]; leftAsWritten: string[] } {
  const { format, documents } = input;
  const textLayout: TextLayout = {
    blankLineSeparator: layout.blankLineSeparator,
    uppercasedWords: layout.uppercasedWords,
    ...(layout.textStyle === undefined ? {} : { textStyle: layout.textStyle }),
  };
  const textPart = {
    label: 'Text',
    included: layout.includeText,
    render: (before: number) => itemText(input, item, textLayout, before),
  };
  const notesPart = {
    label: 'Notes',
    included: layout.includeNotes,
    render: (before: number) => renderText(documents.text(item.id, 'notes'), input, {}, before),
  };
  const synopsisPart = {
    label: 'Synopsis',
    included: layout.includeSynopsis,
    render: (): Rendered => {
      const synopsis = documents.synopsis(item.id);
      return {
        text: synopsis === '' ? undefined : BoundText.of(synopsis),
        notes: [],
        leftAsWritten: [],
      };
    },
  };
  const included = [
    synopsisPart,
    ...(format.notesBeforeText ? [notesPart, textPart] : [textPart, notesPart]),
  ].filter((part) => part.included);
  const subtitled = format.includeSubtitles && included.length > 1;
  if (layout.includeMetadata && subtitled) {
    throw new UnsupportedError('metadata with subtitles');
  }
  const parts: BoundText[] = layout.includeMetadata
    ? [BoundText.of(metadataPart(input.project, item))]
    : [];
  const notes: BoundText[] = [];
  const leftAsWritten: string[] = [];
  for (const { label, render } of included) {
    const rendered = render(notesBefore + notes.length);
    notes.push(...rendered.notes);
    leftAsWritten.push(...rendered.leftAsWritten);
    if (rendered.text === undefined) continue;
    parts.push(subtitled ? BoundText.join([`**${label}**  \n`, rendered.text]) : rendered.text);
  }
  return { parts, notes, leftAsWritten };
}

/** A layout's metadata: created and modified dates, status and label, one tabbed line each. */
function metadataPart(project: Project, item: BinderItem): string {
  if (project.customFields.length > 0) {
    throw new UnsupportedError('metadata in a project with custom metadata fields');
  }
  return [
    ['Created', longDateTime(item.created)],
    ['Modified', longDateTime(item.modified)],
    ['Status', statusName(project, item) ?? 'No Status'],
    ['Label', labelName(project, item) ?? 'No Label'],
  ]
    .map(([name, value]) => `\t${name}:\t${value}`)
    .join('\n');
}

/** A binder date (`2026-10-31 01:13:04 -0400`) as `October 31, 2026 at 1:13 AM`. */
function longDateTime(stamp: string): string {
  return usDate(stampDate(stamp), { dateStyle: 'long', timeStyle: 'short' });
}

/** An item's text, rendered; media has none a compile can write. */
export function itemText(
  input: CompileInput,
  item: BinderItem,
  layout: TextLayout = {},
  notesBefore = 0,
): Rendered {
  if (!keepsText(item.type)) throw new UnsupportedError('media items in the Draft folder');
  return renderText(input.documents.text(item.id), input, layout, notesBefore, item.id);
}

/**
 * How many line breaks start the first suffix after an item's text.  After a footnote the suffix
 * loses one.  After a list it is set apart by an empty line, as MultiMarkdown needs, its own line
 * breaks counting towards it; but a list whose last item has no paragraph break runs into a
 * suffix that starts with text, and the separator after that loses a line break (`runsOn`).
 */
function firstSuffixBreaks(entry: PreparedSection, breaks: number) {
  if (entry.endsWithNote && breaks > 0) return { breaks: breaks - 1, runsOn: false };
  const list = entry.breaksAfterList;
  if (list === undefined) return { breaks, runsOn: false };
  if (list === 0 && breaks === 0) return { breaks, runsOn: true };
  return { breaks: Math.max(breaks, 2 - list), runsOn: false };
}

/** The separator after a suffix that ran on into a list: an empty line becomes a line break. */
function afterRunOn(separator: string): string {
  if (separator !== BLANK_LINE) {
    throw new UnsupportedError(
      'a suffix run on into a list before a separator other than a return',
    );
  }
  return '\n';
}

/**
 * The sections, each followed by its separator: the layout's "after" separator, when it sets one,
 * after its items.  Suffixes placed after subdocuments follow the item's last descendant,
 * innermost first.
 */
export function joinSections(entries: PreparedSection[], format: CompileFormat): BoundText {
  const isFolder = (entry: PreparedSection) => entry.item.type === 'Folder';
  const separatorsOf = (entry: PreparedSection) =>
    entry.layout?.separators ?? (isFolder(entry) ? format.folderSeparators : format.textSeparators);
  const waiting: { level: number; suffix: NonNullable<PreparedSection['lateSuffix']> }[] = [];
  const parts: (string | BoundText)[] = [];
  // A suffix ran on into a list, and the next separator loses a line break.
  let runsOn = false;
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    if (previous) {
      const separators = separatorsOf(entry);
      // A layout's own separators go by layout; the format's, by folders and texts.
      const same = entry.layout?.separators
        ? previous.layout?.id === entry.layout.id
        : isFolder(previous) === isFolder(entry);
      const separator =
        separatorsOf(previous).after ?? (same ? separators.between : separators.before);
      // Return separators count a prefix's closing empty lines towards themselves; others do not.
      const custom = separator !== BLANK_LINE && separator !== PAGE_BREAK;
      if (custom && previous.droppedBreaks) parts.push('\n'.repeat(previous.droppedBreaks));
      parts.push(runsOn ? afterRunOn(separator) : separator);
    }
    runsOn = false;
    parts.push(entry.text);
    if (entry.lateSuffix) waiting.push({ level: entry.level, suffix: entry.lateSuffix });
    const nextLevel = entries[index + 1]?.level ?? 0;
    let first = true;
    for (let last = waiting.at(-1); last && nextLevel <= last.level; last = waiting.at(-1)) {
      const { suffix } = waiting.pop()!;
      let { breaks } = suffix;
      if (first) ({ breaks, runsOn } = firstSuffixBreaks(entry, breaks));
      parts.push('\n'.repeat(breaks), suffix.rest);
      first = false;
    }
  });
  return BoundText.join(parts);
}
