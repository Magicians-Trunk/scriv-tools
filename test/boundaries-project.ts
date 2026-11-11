/**
 * The boundaries fixture: where replacements reach, and which separator comes between sections.
 *
 * One replacement, Alpha to Omega, against the word in an item's text, in its title as a layout
 * prefix's `<$title>`, in a custom field the prefix writes, in the project title the metadata
 * writes, and in a metadata value of the format's own.  Every separator is custom text naming
 * itself, and the sections pass between folders and texts, of the same section type and not, all
 * in one layout: which separator each boundary gets shows what Scrivener goes by.
 */
import type { ProjectSpec } from './project-builder.ts';
import { PARA, rtfDocument } from './rtf-builder.ts';

const rtfField = (text: string) => `<![CDATA[${rtfDocument(text)}]]>`;

/** A custom separator, its text naming it. */
const custom = (name: string, text: string) =>
  `<${name} Type="Custom"><![CDATA[${text}]]></${name}>`;

const separators = (kind: string) =>
  `${custom('Before', `${kind}-BEFORE`)}${custom('Between', `${kind}-BETWEEN`)}<AfterOverride Use="No" Type="Single"/>`;

export const boundaries: ProjectSpec = {
  title: 'Alpha Boundaries',
  sectionTypes: ['Other'],
  customFields: [{ id: 'tag', title: 'Tag' }],
  metadata: { Note: 'Alpha note' },
  formats: [
    {
      name: 'Fixture Boundaries',
      id: 'F7000000-0000-4000-8000-000000000001',
      layouts: [
        {
          name: 'Plain',
          include: 'Titles="No" Text="Yes"',
          settings: `<Prefix>${rtfField(`[<$title>|<$custom:Tag>|<$projecttitle>]${PARA}`)}</Prefix>`,
        },
      ],
      assign: { Heading: 'Plain', Section: 'Plain', Other: 'Plain' },
      separatorSettings:
        `<SeparatorSettings><FolderSeparators>${separators('FOLDER')}</FolderSeparators>` +
        `<TextSeparators>${separators('TEXT')}</TextSeparators></SeparatorSettings>`,
      replacements:
        '<Replacements><Replacement><Replace><![CDATA[Alpha]]></Replace><With><![CDATA[Omega]]></With></Replacement></Replacements>',
    },
  ],
  items: [
    { title: 'Alpha Folder', type: 'Folder', custom: { tag: 'Alpha tag' } },
    { title: 'Alpha One', text: 'Alpha body' },
    { title: 'Two', text: 'two' },
    { title: 'Three', section: 'Other', text: 'three' },
    { title: 'Four Folder', type: 'Folder' },
    { title: 'Five Folder', type: 'Folder', section: 'Other' },
    { title: 'Six', text: 'six' },
  ],
};
