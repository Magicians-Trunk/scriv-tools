/**
 * The leftovers fixture: the shapes behind the lines where L&L's manual and the CLI still differ.
 * A shortcut link in a paragraph style (manual line 2355), a late suffix that starts with an empty
 * paragraph after a footnote (3069) or a list item with line separators (15644), a character style
 * broken by a deleted one (12253), and a section whose only text is deleted (14856).
 */
import type { ProjectSpec } from './project-builder.ts';
import { LIST, PARA, PLAIN, footnote, link, listItem, rtfDocument } from './rtf-builder.ts';

const rtfField = (text: string) => `<![CDATA[${rtfDocument(text)}]]>`;
const STYLE_FORMAT = `<Format><![CDATA[${rtfDocument('Attributes')}]]></Format>`;
const charStyle = (name: string, id: string, settings: string) =>
  `<Style Name="${name}" ID="${id}" Type="Char">${STYLE_FORMAT}${settings}</Style>`;

const TARGET = 'A7000000-0000-4000-8000-000000000001';
const OTHER = 'A7000000-0000-4000-8000-000000000002';
const LAYOUTS = ['Plain', 'Returning', 'Minitoc'];

/** A link whose text is the shortcut placeholder in Interface Labels, style `index`. */
const shortcut = (target: string, index: number) =>
  `${link(`scrivlnk://${target}`, `<$Scr_Cs::${index}><$custom:shortcut>`)}<!$Scr_Cs::${index}>`;

/** Two items of a numbered list; the last holds two line separators, as the manual's does. */
const SEPARATED_LIST =
  `${LIST}${listItem(2, 0, '1.', 'Select the entry.')}` +
  '\\ls2\\ilvl0 {\\listtext\t2.\t}Click the button.\\uc0\\u8232 \\u8232 The default shows in bold.';

const chapter = (title: string, section: string, child: { title: string; text: string }) => ({
  title,
  section,
  text: `${title} text`,
  children: [{ ...child, section: 'Plain' }],
});

export const leftovers: ProjectSpec = {
  title: 'Leftovers Fixture',
  sectionTypes: LAYOUTS,
  customFields: [{ id: 'shortcut', title: 'MacShortcut' }],
  projectStyles: ['Bullet Indent', 'Caption'],
  characterStyles: ['Interface Labels', 'Win-Only Text', 'Other Labels'],
  formats: [
    {
      name: 'Fixture Leftovers',
      id: 'F7000000-0000-4000-8000-000000000001',
      // The manual's three replacements, with plain words for its LaTeX.
      replacements:
        '<Replacements><Replacement><Replace><![CDATA[<$custom:shortcut>]]></Replace><With><![CDATA[<$custom:MacShortcut>]]></With></Replacement>' +
        '<Replacement RegEx="Yes"><Replace><![CDATA[(?<=\\d)\\\\"]]></Replace><With><![CDATA[DIGITQUOTE]]></With></Replacement>' +
        '<Replacement RegEx="Yes"><Replace><![CDATA[(?<!\\d)\\\\"]]></Replace><With><![CDATA[QUOTE]]></With></Replacement></Replacements>',
      styles:
        charStyle(
          'Interface Labels',
          'F7000000-0000-4000-8000-000000000010',
          '<Prefix>{</Prefix><Suffix>}</Suffix>',
        ) +
        charStyle(
          'Win-Only Text',
          'F7000000-0000-4000-8000-000000000011',
          '<DeleteText>Yes</DeleteText>',
        ) +
        charStyle(
          'Other Labels',
          'F7000000-0000-4000-8000-000000000012',
          '<Prefix>[</Prefix><Suffix>]</Suffix>',
        ),
      layouts: [
        { name: 'Plain', include: 'Titles="Yes" Text="Yes"' },
        {
          name: 'Returning',
          include: 'Titles="Yes" Text="Yes"',
          settings: `<Suffix AfterSubdocs="Yes">${rtfField(`RETURN${PARA}`)}</Suffix>`,
        },
        {
          // The manual's late suffix: an empty paragraph, a fenced block, two empty paragraphs.
          name: 'Minitoc',
          include: 'Titles="Yes" Text="Yes"',
          settings: `<Suffix AfterSubdocs="Yes">${rtfField(`${PARA}\`\`\`${PARA}RETURN${PARA}\`\`\`${PARA}${PARA}`)}</Suffix>`,
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
      id: TARGET,
      title: 'Split Vertically',
      text: 'Target.',
      custom: { shortcut: 'Cmd-\\"' },
      include: false,
    },
    {
      id: OTHER,
      title: 'Split Horizontally',
      text: 'Other.',
      custom: { shortcut: 'Opt-Cmd-=' },
      include: false,
    },
    {
      title: 'Link in a paragraph style',
      section: 'Plain',
      styles: ['Bullet Indent', 'Interface Labels'],
      text: `<$Scr_Ps::0>A use ${shortcut(TARGET, 1)}.<!$Scr_Ps::0>`,
    },
    {
      title: 'Two link paragraphs',
      section: 'Plain',
      styles: ['Interface Labels'],
      text: `1. B use ${shortcut(OTHER, 0)} first.${PARA}2. B use ${shortcut(TARGET, 0)}.`,
    },
    {
      title: 'Two link paragraphs in a paragraph style',
      section: 'Plain',
      styles: ['Bullet Indent', 'Interface Labels'],
      text: `<$Scr_Ps::0>1. C use ${shortcut(OTHER, 1)} first.${PARA}2. C use ${shortcut(TARGET, 1)}.<!$Scr_Ps::0>`,
    },
    {
      title: 'As the manual has it',
      section: 'Plain',
      styles: ['Caption', 'Bullet Indent', 'Interface Labels'],
      text:
        `D opening paragraph.${PARA}<$Scr_Ps::0>A caption.${PARA}<!$Scr_Ps::0>The buttons are:${PARA}` +
        `<$Scr_Ps::1>1. D use ${shortcut(OTHER, 2)} first.${PARA}2. D use ${shortcut(TARGET, 2)}.${PARA}` +
        `3. D closes the split.<!$Scr_Ps::1>`,
    },
    chapter('Minitoc after a footnote', 'Minitoc', {
      title: 'Ends with a note',
      text: `ends with a note${footnote('the note ')}`,
    }),
    chapter('Minitoc after a footnote and a full stop', 'Minitoc', {
      title: 'Ends with a note, then a full stop',
      text: `ends with a note${footnote('the note')}.`,
    }),
    chapter('Minitoc after text', 'Minitoc', { title: 'Ends with text', text: 'ends with text' }),
    chapter('Minitoc after a list', 'Minitoc', {
      title: 'Ends with a list',
      text: `before${PARA}${LIST}${listItem(2, 0, '1.', 'one')}${listItem(2, 0, '2.', 'two')}${PLAIN}`,
    }),
    chapter('Minitoc after line separators', 'Minitoc', {
      title: 'Ends with line separators in a list',
      text: `before${PARA}${SEPARATED_LIST}`,
    }),
    chapter('Returning after line separators', 'Returning', {
      title: 'Ends with line separators in a list, before a plain suffix',
      text: `before${PARA}${SEPARATED_LIST}`,
    }),
    {
      title: 'Deleted between the same style',
      section: 'Plain',
      styles: ['Interface Labels', 'Win-Only Text'],
      text: `Use the <$Scr_Cs::0>File//OPML<!$Scr_Cs::0><$Scr_Cs::1> or MindMap<!$Scr_Cs::1><$Scr_Cs::0> File...<!$Scr_Cs::0> command.`,
    },
    {
      title: 'Deleted between two styles',
      section: 'Plain',
      styles: ['Interface Labels', 'Win-Only Text', 'Other Labels'],
      text: `Use the <$Scr_Cs::0>File//OPML<!$Scr_Cs::0><$Scr_Cs::1> or MindMap<!$Scr_Cs::1><$Scr_Cs::2> File...<!$Scr_Cs::2> command.`,
    },
    {
      title: 'Kept between the same style',
      section: 'Plain',
      styles: ['Interface Labels', 'Other Labels'],
      text: `Use the <$Scr_Cs::0>File//OPML<!$Scr_Cs::0><$Scr_Cs::1> or MindMap<!$Scr_Cs::1><$Scr_Cs::0> File...<!$Scr_Cs::0> command.`,
    },
    {
      title: 'Same style twice, nothing between',
      section: 'Plain',
      styles: ['Interface Labels'],
      text: `Use the <$Scr_Cs::0>File//OPML<!$Scr_Cs::0><$Scr_Cs::0> File...<!$Scr_Cs::0> command.`,
    },
    {
      title: 'Only deleted text',
      section: 'Plain',
      styles: ['Win-Only Text'],
      text: '<$Scr_Cs::0>All of this is deleted.<!$Scr_Cs::0>',
    },
    {
      title: 'Only deleted text, then a paragraph break',
      section: 'Plain',
      styles: ['Win-Only Text'],
      text: `<$Scr_Cs::0>All of this is deleted.${PARA}<!$Scr_Cs::0>`,
    },
    {
      title: 'Two deleted paragraphs',
      section: 'Plain',
      styles: ['Win-Only Text'],
      text: `<$Scr_Cs::0>Deleted one.${PARA}Deleted two.<!$Scr_Cs::0>`,
    },
    {
      title: 'Deleted, then kept',
      section: 'Plain',
      styles: ['Win-Only Text'],
      text: `<$Scr_Cs::0>Deleted.<!$Scr_Cs::0>${PARA}Kept.`,
    },
    { title: 'After the deleted', section: 'Plain', text: 'last text' },
  ],
};
