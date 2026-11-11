/**
 * The title links fixture: what "Update titles in document links with prefix and suffix" writes
 * for links to sections whose layout adds a title prefix or suffix.  Compile it with both
 * formats; the second leaves the option off.
 */
import type { FormatSpec, LayoutSpec, ProjectSpec } from './project-builder.ts';
import { PARA, link } from './rtf-builder.ts';

const titled = (name: string, titles: string, include = 'Titles="Yes" Text="Yes"'): LayoutSpec => ({
  name,
  include,
  settings: `<Titles>${titles}</Titles>`,
});

const LAYOUTS: LayoutSpec[] = [
  titled('Plain', ''),
  titled('Prefixed', '<Prefix>Part </Prefix>'),
  titled('Suffixed', '<Suffix> (end)</Suffix>'),
  titled('Both', '<Prefix>Part </Prefix><Suffix> (end)</Suffix>'),
  titled('Counted', '<Prefix>&lt;$n&gt;. </Prefix>'),
  titled('Newline', '<Prefix>Chapter &lt;$n:chapter&gt;\n</Prefix>'),
  titled('Uppercase', '<Prefix>Part </Prefix><TitleCase>Uppercase</TitleCase>'),
  titled('Untitled', '<Prefix>Part </Prefix>', 'Titles="No" Text="Yes"'),
];
const TYPES = LAYOUTS.map(({ name }) => name);

const format = (name: string, id: string, titleLinks: string): FormatSpec => ({
  name,
  id,
  layouts: LAYOUTS,
  assign: { Heading: 'Plain', Section: 'Plain', ...Object.fromEntries(TYPES.map((t) => [t, t])) },
  titleLinks,
});

/** A target section for each layout, with a fixed binder ID. */
const targets = TYPES.map((type, index) => ({
  id: `A5000000-0000-4000-8000-00000000000${index + 1}`,
  title: `${type} Target`,
  section: type,
  text: `${type} text.`,
}));
const NOT_COMPILED = 'A5000000-0000-4000-8000-000000000099';

export const titleLinks: ProjectSpec = {
  title: 'Title Links Fixture',
  sectionTypes: TYPES,
  options: { convertLinksToMmd: true },
  formats: [
    format(
      'Fixture Title Links',
      'F5000000-0000-4000-8000-000000000001',
      '<TitleLinks><UpdateLinksWithPrefixAndSuffix>Yes</UpdateLinksWithPrefixAndSuffix>' +
        '<PrefixSeparator NewlinesOnly="Yes"><![CDATA[ - ]]></PrefixSeparator></TitleLinks>',
    ),
    format(
      'Fixture Title Links Off',
      'F5000000-0000-4000-8000-000000000002',
      '<TitleLinks><PrefixSeparator NewlinesOnly="Yes"><![CDATA[ - ]]></PrefixSeparator></TitleLinks>',
    ),
  ],
  items: [
    {
      title: 'Links',
      section: 'Plain',
      text: [
        ...targets.map(
          ({ id, title }) => `To ${title}: ${link(`scrivlnk://${id}`, 'other words')}`,
        ),
        ...targets.map(({ id, title }) => `Named ${title}: ${link(`scrivlnk://${id}`, title)}`),
        `Not compiled: ${link(`scrivlnk://${NOT_COMPILED}`, 'other words')}`,
      ].join(PARA),
    },
    ...targets,
    {
      id: NOT_COMPILED,
      title: 'Prefixed Elsewhere',
      section: 'Prefixed',
      text: 'Not compiled.',
      include: false,
    },
  ],
};
