import { type CompiledImage, defineImage } from './resolve-markup.ts';
import { pictureBytes } from './rich-text-reader.ts';
import { type BinderItem } from './binder-item.ts';
import { BoundText, type LinkWriter } from './bound-text.ts';
import { linkWriter } from './compile-links.ts';
import { SMART_PUNCTUATION, type CompileFormat } from './compile-format.ts';
import { type CompileSettings, filteredOut } from './compile-settings.ts';
import { type Documents } from './document.ts';
import { type Rendered } from './document-text.ts';
import { isMetadataDocument, metadataBlock } from './metadata.ts';
import { type CompileInput, compileInput, type ScrivenerModel } from './model.ts';
import { hierarchicalNumbers } from './numbering.ts';
import { type Evaluated, numberingTag, Placeholders, type ProjectNames } from './placeholders.ts';
import { adaptiveTitle, draftFolder, projectName, sectionTypeId, type Project } from './project.ts';
import { applyReplacements } from './replacements.ts';
import {
  type Entry,
  type PreparedSection,
  itemText,
  joinSections,
  sectionContent,
} from './section.ts';
import { lateSuffixParts, layoutText, type SectionLayout } from './section-layout.ts';
import { UnsupportedError } from './unsupported.ts';

/** What a compile takes besides its model. */
export interface CompileOptions {
  /** Fills `<$author>` in place of the project's first author. */
  author?: string;
  /** When the compile runs, for today's-date placeholders.  Defaults to now. */
  now?: Date;
  /**
   * Hears of each `<$…>` the compile leaves as written, as Scrivener does: a placeholder Scrivener
   * does not evaluate, or a style ending with no style open.  With the title of the item it is
   * in (if any).
   */
  onLeftAsWritten?: (placeholder: string, title?: string) => void;
}

/**
 * A compile evaluated but not yet written: the metadata block, each section with its text and
 * suffix, and the footnote definitions, all as text that keeps its marks.  `writeCompile` writes
 * it.  Changing it is up to the caller: the compile matches Scrivener only as prepared.
 */
export interface PreparedCompile {
  format: CompileFormat;
  metadata: BoundText;
  sections: PreparedSection[];
  /** The images the text refers to, by name. */
  images: Map<string, CompiledImage>;
  footnotes: PreparedNote[];
}

/** A footnote's definition, and the item it is in. */
export interface PreparedNote {
  definition: BoundText;
  item: BinderItem;
}

/** An image file a compile refers to, with its name and bytes. */
export interface CompiledFileImage {
  file: string;
  bytes: Uint8Array;
}

/** A footnote's text, and the item it is in, whose placeholders it reads. */
interface Note {
  text: BoundText;
  item: BinderItem;
}

/** A `<$…>` the compile writes out as it is, and the item it is in. */
interface LeftAsWritten {
  placeholder: string;
  item?: BinderItem | undefined;
}

/** Compiles a model to MultiMarkdown, as Scrivener compiles the project it describes. */
export function compileModel(model: ScrivenerModel, options: CompileOptions = {}): string {
  return writeCompile(prepareCompile(model, options));
}

/** A compile's text and the image files it refers to, each with its name and bytes. */
export function compileWithImages(model: ScrivenerModel, options: CompileOptions = {}) {
  const prepared = prepareCompile(model, options);
  const images = [...prepared.images.values()].map((image) => imageFile(model, image));
  return { text: writeCompile(prepared), images };
}

/** An image with the bytes of its file. */
export function imageFile(
  model: ScrivenerModel,
  { file, picture, from }: CompiledImage,
): CompiledFileImage {
  return { file, bytes: picture ? pictureBytes(picture) : model.project.files.read(from!) };
}

/**
 * Evaluates a model's compile, ready to write: every placeholder, replacement and layout
 * applied, and nothing yet written.
 */
export function prepareCompile(
  model: ScrivenerModel,
  options: CompileOptions = {},
): PreparedCompile {
  const input = compileInput(model);
  const { project, settings, format, assignment, documents } = input;
  const frontMatter =
    assignment.frontMatter === undefined ? undefined : input.index.byId.get(assignment.frontMatter);
  const draft = draftFolder(project);
  if (settings.includeGroupText && documents.text(draft.id).paragraphs.length > 0) {
    throw new UnsupportedError('compiling the text of the Draft folder itself');
  }
  const compiled = [
    ...compiledItems(project, frontMatter?.children ?? [], settings, 1),
    ...compiledItems(project, draft.children, settings, 1),
  ];
  // A first item called "Metadata" adds to the metadata block instead of compiling as a section.
  const metadataItem = isMetadataDocument(compiled[0]?.item) ? compiled[0]!.item : undefined;
  const items = metadataItem ? compiled.slice(1) : compiled;
  const notes: Note[] = [];
  const strays: LeftAsWritten[] = [];
  /** Keeps what an item's rendering numbered and left as written, and returns its text. */
  const collect = <T extends Rendered>(rendered: T, item: BinderItem): T['text'] => {
    notes.push(...rendered.notes.map((text) => ({ text, item })));
    strays.push(...rendered.leftAsWritten.map((placeholder) => ({ placeholder, item })));
    return rendered.text;
  };
  const entries = items.map(({ item, level, inherited }): Entry => {
    const layout = layoutFor(project, item, level, assignment.layouts, format, inherited);
    const images = new Map<string, CompiledImage>();
    const rendered = inItem(input, item, () => {
      const section = sectionContent({ ...input, images }, item, level, layout, notes.length);
      for (const [name, image] of images) defineImage(input.images, name, image);
      return section;
    });
    const content = collect(rendered, item);
    // Which hierarchical numbering the item uses, once replacements have had their say.
    const numbering = numberingTag(applyReplacements(content, input.replacements).text);
    const entry: Entry = { item, level, text: content, images: [...images.keys()] };
    if (numbering !== undefined) entry.numbering = numbering;
    const breaksAfterList = content.breaksAfterList();
    if (breaksAfterList !== undefined) entry.breaksAfterList = breaksAfterList;
    if (content.endsWithNote()) entry.endsWithNote = true;
    if (layout) entry.layout = layout;
    if (rendered.droppedBreaks) entry.droppedBreaks = rendered.droppedBreaks;
    return entry;
  });
  const placeholders = new Placeholders(input, projectNames(project, settings, options), {
    numbers: hierarchicalNumbers(entries.map((entry) => ({ ...entry, kind: entry.numbering }))),
    positions: new Map(entries.map(({ item }, index) => [item.id, index + 1])),
    now: options.now ?? new Date(),
  });
  const finish = (text: string | BoundText, item?: BinderItem) => {
    const done = complete(text, item, input, placeholders);
    strays.push(...done.leftAsWritten.map((placeholder) => ({ placeholder, item })));
    return done.text;
  };
  // The metadata document is rendered after the sections, so its footnotes number after theirs.
  const metadataText =
    metadataItem &&
    BoundText.section(
      finish(
        BoundText.trimmed(
          collect(itemText(input, metadataItem, {}, notes.length), metadataItem) ?? '',
          'end',
        ),
        metadataItem,
      ),
      metadataItem.id,
    );
  // The metadata comes first, before any heading a link in it could name.
  const metadata = metadataBlock(format, settings, finish, metadataText).writeLinks(() => {
    throw new UnsupportedError('a document link in the metadata');
  });
  const sections = entries.map((entry): PreparedSection => {
    const finished = inItem(input, entry.item, () => finish(entry.text, entry.item));
    const text = BoundText.section(finished, entry.item.id);
    const { layout } = entry;
    if (!layout?.suffixAfterSubdocuments || layoutText(layout.suffixLines) === '') {
      return { ...entry, text };
    }
    const { breaks, rest } = lateSuffixParts(layout.suffixLines);
    return {
      ...entry,
      text,
      lateSuffix: {
        breaks,
        rest: BoundText.section(finish(BoundText.deferred(rest), entry.item), entry.item.id),
      },
    };
  });
  const footnotes = noteDefinitions(notes, finish);
  report(strays, input.documents, options);
  return { format, metadata, sections, images: input.images, footnotes };
}

/**
 * Writes a prepared compile, once and at the end: its sections joined with their separators
 * and suffixes, then links, which name headings that are final only now, then trims.
 */
export function writeCompile(prepared: PreparedCompile): string {
  return writeMarked(prepared).text;
}

/** A prepared compile written, keeping the marks that say where its text came from. */
export function writeMarked(prepared: PreparedCompile): BoundText {
  const { metadata, sections, images, footnotes } = prepared;
  return writeParts(prepared.format, [metadata], sections, [...images], footnotes);
}

/** Sections joined, after what comes first and before their images and footnotes. */
export function writeParts(
  format: CompileFormat,
  first: BoundText[],
  sections: PreparedSection[],
  images: [string, CompiledImage][],
  footnotes: PreparedNote[],
  elsewhere?: LinkWriter,
): BoundText {
  const defined = images.map(([name, { definition }]) => `\n\n[${name}]: ${definition}`);
  const whole = BoundText.join([
    ...first,
    joinSections(sections, format),
    ...defined,
    ...footnotes.map(({ definition }) => definition),
  ]);
  return whole.writeLinks(linkWriter(format, sections, whole, elsewhere)).finish();
}

/**
 * One document's text, as a compile of it alone writes it, without its section layout: its
 * links to other documents are plain text, as links to documents a compile leaves out are.
 */
export function readText(
  model: ScrivenerModel,
  item: BinderItem,
  options: CompileOptions = {},
): string {
  const input = compileInput(model);
  const rendered = itemText(input, item);
  const placeholders = new Placeholders(
    input,
    projectNames(input.project, input.settings, options),
  );
  const strays = rendered.leftAsWritten.map((placeholder): LeftAsWritten => ({
    placeholder,
    item,
  }));
  const finish = (text: string | BoundText, inside?: BinderItem) => {
    const done = complete(text, inside, input, placeholders);
    strays.push(...done.leftAsWritten.map((placeholder) => ({ placeholder, item: inside })));
    return done.text;
  };
  const notes = rendered.notes.map((text) => ({ text, item }));
  const definitions = noteDefinitions(notes, finish).map(({ definition }) => definition);
  const text = BoundText.join([finish(rendered.text ?? '', item), ...definitions]);
  report(strays, input.documents, options);
  return text.writeLinks(linkWriter(input.format, [], text)).finish().text;
}

/** Footnote markers are `[^cf1]`, numbered across the compile. */
const FOOTNOTE_LABEL = 'cf';

/** Scrivener's own layout that prints an item as it is. */
const AS_IS_LAYOUT = 'AS-IS';

/**
 * The footnotes' definitions, after everything else, through the same replacements and
 * placeholders as the text; Scrivener trims each note's text at both ends.
 */
function noteDefinitions(
  notes: Note[],
  finish: (text: BoundText, item: BinderItem) => BoundText,
): PreparedNote[] {
  return notes.map(({ text, item }, index) => ({
    item,
    definition: BoundText.join([
      '\n\n',
      BoundText.section(
        BoundText.join([
          `[^${FOOTNOTE_LABEL}${index + 1}]: `,
          finish(BoundText.trimmed(text, 'both'), item),
        ]),
        item.id,
      ),
    ]),
  }));
}

/** Tells the caller of each `<$…>` left as written, once each per item. */
function report(strays: LeftAsWritten[], documents: Documents, options: CompileOptions): void {
  const seen = new Set<string>();
  for (const { placeholder, item } of strays) {
    const key = `${placeholder}\u0000${item?.id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.onLeftAsWritten?.(placeholder, item && adaptiveTitle(item, documents));
  }
}

/** The project's names for placeholders; `--author` wins over the project's first author. */
function projectNames(
  project: Project,
  settings: CompileSettings,
  options: CompileOptions,
): ProjectNames {
  const projectTitle = settings.projectTitle || projectName(project);
  return {
    projectTitle,
    abbreviatedTitle: settings.abbreviatedTitle || projectTitle,
    author: options.author ?? settings.author,
    forename: settings.forename,
    surname: settings.surname,
  };
}

/** Names the binder item when the compile stops on something unsupported inside it. */
function inItem<T>(input: CompileInput, item: BinderItem, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof UnsupportedError) {
      error.message += ` in "${adaptiveTitle(item, input.documents)}" (${item.id})`;
    }
    throw error;
  }
}

/**
 * Finishes compiled text as Scrivener does: placeholders that can be evaluated now, then the
 * replacements (over the format's markup too), then the rest of the placeholders, which may be
 * ones the replacements wrote; then tables' cells are trimmed and the transformations run.
 */
function complete(
  text: string | BoundText,
  item: BinderItem | undefined,
  { replacements, format }: CompileInput,
  placeholders: Placeholders,
): Evaluated {
  const bound = typeof text === 'string' ? BoundText.of(text) : text;
  const known = placeholders.evaluateKnown(bound, item);
  const replaced = applyReplacements(known, replacements, (changed) =>
    placeholders.evaluateFrom(changed, changed.lastParagraphStart(), item),
  );
  const { text: evaluated, leftAsWritten } = placeholders.evaluate(replaced, item);
  const punctuated = format.removeSmartPunctuation
    ? SMART_PUNCTUATION.reduce((result, [from, to]) => result.replace(from, () => to), evaluated)
    : evaluated;
  return { text: punctuated, leftAsWritten };
}

/** An item to compile, its level, and the section type its parent sets for its subdocuments. */
interface CompiledItem {
  item: BinderItem;
  level: number;
  inherited?: string;
}

/** The items to compile, each with its level below the Draft folder (or front matter folder). */
function compiledItems(
  project: Project,
  items: BinderItem[],
  settings: CompileSettings,
  level: number,
  inherited?: string,
): CompiledItem[] {
  const { scope, filter } = settings;
  return items.flatMap((item) => {
    const included = item.metadata?.includeInCompile === true;
    const checked = scope === 'All' || (scope === 'Excluded' ? !included : included);
    const filtered = filteredOut(item, filter, project);
    // An excluded item's own included items still compile, at their own level.
    // A section type set for subdocuments reaches every descendant, until one sets its own.
    const childType = item.metadata?.sectionType?.childDefault ?? inherited;
    const descendants = compiledItems(project, item.children, settings, level + 1, childType);
    const entry: CompiledItem =
      inherited === undefined ? { item, level } : { item, level, inherited };
    return checked && !filtered ? [entry, ...descendants] : descendants;
  });
}

/** The section type from the item, or from its kind and level, then the format's layout. */
function layoutFor(
  project: Project,
  item: BinderItem,
  level: number,
  layouts: Map<string, string>,
  format: CompileFormat,
  inherited?: string,
): SectionLayout | undefined {
  const typeId = sectionTypeId(project, item, level, inherited);
  const layoutId = typeId === undefined ? undefined : layouts.get(typeId);
  if (layoutId === undefined || layoutId === AS_IS_LAYOUT) return undefined;
  const layout = format.layouts.get(layoutId);
  if (!layout) throw new UnsupportedError(`built-in section layout ${layoutId}`);
  return layout;
}
