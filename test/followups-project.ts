/**
 * The follow-ups fixture: the questions the leftovers and title links fixtures left.  A list whose
 * last paragraph has no paragraph break before a suffix after subdocuments (Scrivener ran the
 * suffix on and lost a line break), a footnote before suffixes with more empty paragraphs, a
 * character style broken by deleted text twice, and links to sections without a heading or with
 * a replacement in the title.
 */
import type { ProjectSpec } from './project-builder.ts';
import { LIST, PARA, PLAIN, footnote, link, listItem, rtfDocument } from './rtf-builder.ts';

const rtfField = (text: string) => `<![CDATA[${rtfDocument(text)}]]>`;
const STYLE_FORMAT = `<Format><![CDATA[${rtfDocument('Attributes')}]]></Format>`;
const charStyle = (name: string, id: string, settings: string) =>
  `<Style Name="${name}" ID="${id}" Type="Char">${STYLE_FORMAT}${settings}</Style>`;

const LAYOUTS = ['Plain', 'Returning', 'Minitoc', 'Spaced', 'Untitled'];
const SEPARATORS = '\\uc0\\u8232 \\u8232 ';
const UNTITLED = 'A9000000-0000-4000-8000-000000000001';
const SWAPPED = 'A9000000-0000-4000-8000-000000000002';
const PLAIN_TARGET = 'A9000000-0000-4000-8000-000000000003';

/** A numbered list of two items, the last one `last`, which ends the text. */
const list = (last: string) =>
  `${LIST}${listItem(2, 0, '1.', 'one')}\\ls2\\ilvl0 {\\listtext\t2.\t}${last}`;

const chapter = (title: string, section: string, text: string) => ({
  title,
  section,
  text: `${title} text`,
  children: [{ title: `${title}, the child`, section: 'Plain', text }],
});

export const followups: ProjectSpec = {
  title: 'Follow-ups Fixture',
  sectionTypes: LAYOUTS,
  characterStyles: ['Interface Labels', 'Win-Only Text'],
  options: { convertLinksToMmd: true },
  formats: [
    {
      name: 'Fixture Follow-ups',
      id: 'F9000000-0000-4000-8000-000000000001',
      replacements:
        '<Replacements><Replacement><Replace><![CDATA[Swapped]]></Replace><With><![CDATA[Changed]]></With></Replacement></Replacements>',
      styles:
        charStyle(
          'Interface Labels',
          'F9000000-0000-4000-8000-000000000010',
          '<Prefix>{</Prefix><Suffix>}</Suffix>',
        ) +
        charStyle(
          'Win-Only Text',
          'F9000000-0000-4000-8000-000000000011',
          '<DeleteText>Yes</DeleteText>',
        ),
      layouts: [
        { name: 'Plain', include: 'Titles="Yes" Text="Yes"' },
        {
          name: 'Returning',
          include: 'Titles="Yes" Text="Yes"',
          settings: `<Suffix AfterSubdocs="Yes">${rtfField(`RETURN${PARA}`)}</Suffix>`,
        },
        {
          name: 'Minitoc',
          include: 'Titles="Yes" Text="Yes"',
          settings: `<Suffix AfterSubdocs="Yes">${rtfField(`${PARA}\`\`\`${PARA}RETURN${PARA}\`\`\`${PARA}${PARA}`)}</Suffix>`,
        },
        {
          // A late suffix that starts with two empty paragraphs.
          name: 'Spaced',
          include: 'Titles="Yes" Text="Yes"',
          settings: `<Suffix AfterSubdocs="Yes">${rtfField(`${PARA}${PARA}RETURN${PARA}`)}</Suffix>`,
        },
        { name: 'Untitled', include: 'Titles="No" Text="Yes"' },
      ],
      assign: {
        Heading: 'Plain',
        Section: 'Plain',
        ...Object.fromEntries(LAYOUTS.map((name) => [name, name])),
      },
    },
  ],
  items: [
    chapter('Unended list item', 'Returning', `before${PARA}${list('two')}`),
    chapter(
      'Unended list item with separators',
      'Returning',
      `before${PARA}${list(`two${SEPARATORS}more`)}`,
    ),
    chapter(
      'Ended list item with separators',
      'Returning',
      `before${PARA}${list(`two${SEPARATORS}more${PARA}`)}${PLAIN}`,
    ),
    chapter('Unended list item, Minitoc', 'Minitoc', `before${PARA}${list('two')}`),
    chapter('Unended text', 'Returning', 'ends with text'),
    chapter(
      'Note before two empty paragraphs',
      'Spaced',
      `ends with a note${footnote('the note')}`,
    ),
    chapter(
      'Note and a break before Minitoc',
      'Minitoc',
      `ends with a note${footnote('the note')}${PARA}`,
    ),
    chapter('Text before two empty paragraphs', 'Spaced', 'ends with text'),
    {
      title: 'Deleted twice between the same style',
      section: 'Plain',
      styles: ['Interface Labels', 'Win-Only Text'],
      text:
        'Use <$Scr_Cs::0>one<!$Scr_Cs::0><$Scr_Cs::1> gone<!$Scr_Cs::1><$Scr_Cs::0> two<!$Scr_Cs::0>' +
        '<$Scr_Cs::1> gone<!$Scr_Cs::1><$Scr_Cs::0> three<!$Scr_Cs::0> now.',
    },
    {
      title: 'Links',
      section: 'Plain',
      text: [
        `To untitled: ${link(`scrivlnk://${UNTITLED}`, 'other words')}`,
        `To swapped: ${link(`scrivlnk://${SWAPPED}`, 'other words')}`,
        `Named swapped: ${link(`scrivlnk://${SWAPPED}`, 'Swapped Title')}`,
        `To plain: ${link(`scrivlnk://${PLAIN_TARGET}`, 'Plain Target')}`,
      ].join(PARA),
    },
    { id: UNTITLED, title: 'Untitled Target', section: 'Untitled', text: 'Untitled text.' },
    { id: SWAPPED, title: 'Swapped Title', section: 'Plain', text: 'Swapped text.' },
    { id: PLAIN_TARGET, title: 'Plain Target', section: 'Plain', text: 'Plain text.' },
  ],
};
