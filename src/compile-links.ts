/** How a compile writes document links. */
import { type BinderItem } from './binder-item.ts';
import { type BoundText, type HeadingParts, type LinkWriter } from './bound-text.ts';
import { type CompileFormat } from './compile-format.ts';
import { type PreparedSection } from './section.ts';
import { type SectionLayout } from './section-layout.ts';
import { UnsupportedError } from './unsupported.ts';

/**
 * How the compile writes document links, once every heading is final.  A link names the heading
 * of the section it links to, its first line; text that is the same as that is not written
 * twice.  "Update titles in document links" gives a link whose text is the section's title the
 * heading's text instead, its title as typed and on one line.  A link to an item not in these
 * sections is `elsewhere`'s to write, and by default plain text, as is one to an item written
 * without a heading.
 */
export function linkWriter(
  format: CompileFormat,
  sections: PreparedSection[],
  compiled: BoundText,
  elsewhere: LinkWriter = () => undefined,
): LinkWriter {
  const headings = compiled.headings();
  const compiledSections = new Map(sections.map((section) => [section.item.id, section]));
  return (id, text) => {
    const section = compiledSections.get(id);
    if (!section) return elsewhere(id, text);
    const { item, layout } = section;
    // A section without a heading leaves nothing to link to.
    const heading = layout && headingOf(layout, item);
    if (!heading) return undefined;
    const parts = headings.get(id);
    if (!parts) throw new UnsupportedError('a document link to a heading with no text');
    const { prefix = '', title: written = '', suffix = '' } = parts;
    const [ref = ''] = `${prefix}${written}${suffix}`.split('\n');
    return { text: linkText(format, section, parts, text), ref: ref.trim() };
  };
}

/** A link's text, which "Update titles in document links" makes the heading's, as typed. */
export function linkText(
  format: CompileFormat,
  { item, layout }: PreparedSection,
  { prefix = '', suffix = '' }: HeadingParts,
  text: string,
): string {
  if (!format.updateTitleLinks || text !== item.title) return text;
  const typed = layout?.includeTitles ? item.title : '';
  return `${prefix}${typed}${suffix}`.replaceAll('\n', ' ').trim();
}

/**
 * Whether the section's layout writes a heading links can name.  Only headings set off by hashes,
 * with the suffix inside them unstyled, are known.
 */
function headingOf(layout: SectionLayout, item: BinderItem): boolean {
  const { titles } = layout;
  const decorated = titles.prefix !== '' || titles.suffix !== '';
  if (!(layout.includeTitles ? item.title !== undefined : decorated)) return false;
  const plain =
    !titles.runIn &&
    titles.hashCount !== 0 &&
    (titles.suffix === '' || (!titles.suffixAfterHashes && titles.suffixStyle === undefined));
  if (!plain) throw new UnsupportedError(`a document link to a "${layout.name}" title`);
  return true;
}
