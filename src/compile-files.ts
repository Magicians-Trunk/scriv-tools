/** A compile written to many files: one for each value of a custom field. */
import { type BinderItem } from './binder-item.ts';
import { type LinkWriter } from './bound-text.ts';
import { type CompileFormat } from './compile-format.ts';
import {
  type CompiledFileImage,
  type CompileOptions,
  imageFile,
  type PreparedCompile,
  prepareCompile,
  writeParts,
} from './compile.ts';
import { linkText } from './compile-links.ts';
import { type ScrivenerModel } from './model.ts';
import { joinSections, type PreparedSection } from './section.ts';

/** One file of a compile written to many: the items a custom field gave the same value. */
export interface CompiledFile {
  /** The field's value, as it is written, or the file `fileOf` gave it. */
  name: string;
  /** The items the file holds, in binder order. */
  items: BinderItem[];
  text: string;
  images: CompiledFileImage[];
}

/** A compile written to many files, and the items it compiles that no value names. */
export interface CompiledFiles {
  files: CompiledFile[];
  unnamed: BinderItem[];
}

/** What a compile to many files takes besides its model and field. */
export interface CompileFilesOptions extends CompileOptions {
  /** Whether a value's file gets written, so links can go to it.  Defaults to every value's. */
  writes?: (name: string) => boolean;
  /** The file an item with a value goes in, when that is not the value. */
  fileOf?: (value: string, item: BinderItem) => string;
}

/**
 * The characters a link's destination holds of a path part as they are: those a URL's path lets
 * stand, which Markdown reads as written too.  Parentheses would end the destination, and `&`
 * could start an entity, so those are encoded with the rest.
 */
const AS_WRITTEN = /^[\w.~!*'@$+,;=-]$/;

/** A character as percent-encoded bytes. */
const percentEncoded = (character: string) =>
  Array.from(
    new TextEncoder().encode(character),
    (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
  ).join('');

/** One part of a path, as a link's destination holds it. */
const encodedPart = (part: string) =>
  Array.from(part, (character) =>
    AS_WRITTEN.test(character) ? character : percentEncoded(character),
  ).join('');

/**
 * The way to a file from another's folder, as a link's destination holds it: each part encoded.
 * Both are paths from the output's top folder.
 */
export function fileLinkPath(from: string, to: string): string {
  const folder = from.split('/').slice(0, -1);
  const target = to.split('/');
  let shared = 0;
  while (shared < folder.length && folder[shared] === target[shared]) shared += 1;
  const up = folder.slice(shared).map(() => '..');
  return [...up, ...target.slice(shared).map(encodedPart)].join('/');
}

/** A section, and the value of the file it is written to. */
interface PlacedSection {
  name: string;
  section: PreparedSection;
}

/**
 * Links from each file to the sections of others, each to the other file alone: a heading is only
 * a name in the compile, which writes no anchor for a file to link to.
 */
function linksBetween(format: CompileFormat, placed: PlacedSection[]) {
  const sections = placed.map(({ section }) => section);
  const headings = joinSections(sections, format).headings();
  const places = new Map(placed.map((place) => [place.section.item.id, place]));
  return (from: string): LinkWriter =>
    (id, text) => {
      const place = places.get(id);
      if (!place) return undefined;
      const parts = headings.get(id);
      return {
        text: parts ? linkText(format, place.section, parts, text) : text,
        href: fileLinkPath(from, place.name),
      };
    };
}

/**
 * Compiles to one file for each value of a custom field.  The compile is the project's, evaluated
 * once, so numbers and placeholders are what one file would have, and a section reads as it does
 * there.  Items with the same value share a file, joined by the format's separators, and each file
 * has the footnotes and images of its own sections.  A link to a section in another file links to
 * that file; one to a section with no file written is plain text.  The metadata block has no
 * section, so no file.
 */
export function compileFiles(
  model: ScrivenerModel,
  field: string,
  { writes = () => true, fileOf = (value) => value, ...options }: CompileFilesOptions = {},
): CompiledFiles {
  const prepared = prepareCompile(model, options);
  const valueOf = ({ item }: PreparedSection) => item.metadata?.custom[field] ?? '';
  const named = Map.groupBy(prepared.sections.filter(valueOf), (section) =>
    fileOf(valueOf(section), section.item),
  );
  const written = [...named].filter(([name]) => writes(name));
  const placed = written.flatMap(([name, sections]) =>
    sections.map((section) => ({ name, section })),
  );
  const linksFrom = linksBetween(prepared.format, placed);
  const files = [...named].map(([name, sections]): CompiledFile => {
    const { text, images } = writeSections(prepared, sections, linksFrom(name));
    return {
      name,
      items: sections.map(({ item }) => item),
      text,
      images: images.map((image) => imageFile(model, image)),
    };
  });
  const unnamed = prepared.sections.filter((section) => !valueOf(section));
  return { files, unnamed: unnamed.map(({ item }) => item) };
}

/**
 * Some of a compile's sections written alone: the text of those sections, the images they refer
 * to, and their footnotes, under the numbers the whole compile gave them.  A link to a section
 * left out is `elsewhere`'s to write, and by default plain text, as a link to an item the compile
 * leaves out is.
 */
export function writeSections(
  prepared: PreparedCompile,
  sections: PreparedSection[],
  elsewhere?: LinkWriter,
) {
  const names = new Set(sections.flatMap(({ images }) => images));
  const images = [...prepared.images].filter(([name]) => names.has(name));
  const items = new Set(sections.map(({ item }) => item));
  const footnotes = prepared.footnotes.filter(({ item }) => items.has(item));
  const { text } = writeParts(prepared.format, [], sections, images, footnotes, elsewhere);
  return { text, images: images.map(([, image]) => image) };
}
