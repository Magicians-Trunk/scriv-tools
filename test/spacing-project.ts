/**
 * The spacing fixture: where L&L's manual and the CLI differ in blank lines.  A prefix after the
 * title that ends in an empty paragraph, a suffix after subdocuments that follows a footnote or a
 * list, and a section whose children are all filtered out.
 */
import type { ProjectSpec } from './project-builder.ts';
import { BULLET, LIST, PARA, PLAIN, footnote, listItem, rtfDocument } from './rtf-builder.ts';

const rtfField = (text: string) => `<![CDATA[${rtfDocument(text)}]]>`;
const LAYOUTS = ['Plain', 'Chapter', 'Returning'];

export const spacing: ProjectSpec = {
  title: 'Spacing Fixture',
  sectionTypes: LAYOUTS,
  excludeLabel: '4',
  formats: [
    {
      name: 'Fixture Spacing',
      id: 'F4000000-0000-4000-8000-000000000001',
      layouts: [
        { name: 'Plain', include: 'Titles="Yes" Text="Yes"' },
        {
          name: 'Chapter',
          include: 'Titles="Yes" Text="Yes"',
          settings: `<Prefix AfterTitle="Yes">${rtfField(`${PARA}BLOCK${PARA}${PARA}`)}</Prefix>`,
        },
        {
          name: 'Returning',
          include: 'Titles="Yes" Text="Yes"',
          settings: `<Suffix AfterSubdocs="Yes">${rtfField(`RETURN${PARA}`)}</Suffix>`,
        },
      ],
      assign: {
        Heading: 'Plain',
        Section: 'Plain',
        ...Object.fromEntries(LAYOUTS.map((name) => [name, name])),
      },
    },
  ],
  items: [
    {
      title: 'Chapter without text',
      section: 'Chapter',
      children: [{ title: 'After the empty chapter', section: 'Plain', text: 'after text' }],
    },
    {
      title: 'Chapter with text',
      section: 'Chapter',
      text: 'chapter text',
      children: [{ title: 'After the chapter', section: 'Plain', text: 'more text' }],
    },
    {
      title: 'Returning after a footnote',
      section: 'Returning',
      text: 'returning text',
      children: [
        {
          title: 'Ends with a note',
          section: 'Plain',
          text: `ends with a note${footnote('the note')}`,
        },
      ],
    },
    {
      title: 'Returning after a note and a line break',
      section: 'Returning',
      text: 'returning text',
      children: [
        {
          title: 'Ends with a note, then a paragraph break',
          section: 'Plain',
          text: `ends with a note${footnote('another note')}${PARA}`,
        },
      ],
    },
    {
      title: 'Returning after a list',
      section: 'Returning',
      text: 'returning text',
      children: [
        {
          title: 'Ends with a list',
          section: 'Plain',
          text: `before${PARA}${LIST}${listItem(1, 0, BULLET, 'one')}${listItem(1, 0, BULLET, 'two')}${PLAIN}`,
        },
      ],
    },
    {
      title: 'Children filtered out',
      section: 'Plain',
      text: '',
      children: [
        { title: 'Filtered one', section: 'Plain', label: '4', text: 'gone' },
        { title: 'Filtered two', section: 'Plain', label: '4', text: 'gone' },
      ],
    },
    { title: 'After the filtered', section: 'Plain', text: 'last text' },
  ],
};
