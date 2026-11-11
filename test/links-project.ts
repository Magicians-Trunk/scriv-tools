/**
 * The links fixture: placeholders on document links, under a regular expression replacement that
 * changes the linked value, and includes the CLI does not handle yet.  L&L's manual compiled two
 * such links differently; this sets them side by side.
 */
import type { ProjectSpec } from './project-builder.ts';
import { PARA, PLAIN, footnote, link, table } from './rtf-builder.ts';

const TARGET = 'A1000000-0000-4000-8000-000000000001';
const INCLUDED = 'A1000000-0000-4000-8000-000000000002';
const TWO_PARAGRAPHS = 'A1000000-0000-4000-8000-000000000003';
const target = `scrivlnk://${TARGET}`;

export const links: ProjectSpec = {
  title: 'Links Fixture',
  customFields: [{ id: 'shortcut', title: 'Shortcut' }],
  characterStyles: ['Outer', 'Inner', 'Marked'],
  formats: [
    {
      name: 'Fixture Links',
      id: 'F3000000-0000-4000-8000-000000000001',
      replacements:
        '<Replacements><Replacement RegEx="Yes"><Replace><![CDATA[(?<!\\d)\\\\"]]></Replace><With><![CDATA[QUOTE]]></With></Replacement>' +
        '<Replacement><Replace><![CDATA[<$gone>]]></Replace><With><![CDATA[]]></With></Replacement>' +
        '<Replacement><Replace><![CDATA[[[]]></Replace><With><![CDATA[<<]]></With></Replacement></Replacements>',
      styles:
        '<Style Name="Marked" ID="F3000000-0000-4000-8000-000000000010" Type="Char"><Format/><Prefix><![CDATA[[[]]></Prefix><Suffix>]]</Suffix></Style>',
    },
  ],
  items: [
    {
      id: TARGET,
      title: 'Target',
      text: 'Target text.',
      custom: { shortcut: 'Cmd-\\"' },
      include: false,
    },
    { id: INCLUDED, title: 'Included', text: 'included words', include: false },
    {
      id: TWO_PARAGRAPHS,
      title: 'Two Paragraphs',
      text: `first paragraph${PARA}second paragraph`,
      include: false,
    },
    { title: 'Plain link', text: `A ${link(target, '<$custom:Shortcut>')} end` },
    {
      title: 'Inner style',
      styles: ['Inner'],
      text: `B ${link(target, '<$Scr_Cs::0><$custom:Shortcut>')}<!$Scr_Cs::0> end`,
    },
    {
      title: 'Outer and inner styles',
      styles: ['Outer', 'Inner'],
      text: `C <$Scr_Cs::0>pre ${link(target, '<!$Scr_Cs::0><$Scr_Cs::1><$custom:Shortcut>')}<!$Scr_Cs::1><$Scr_Cs::0> post<!$Scr_Cs::0>`,
    },
    {
      title: 'Outer style only',
      styles: ['Outer'],
      text: `D <$Scr_Cs::0>pre ${link(target, '<$custom:Shortcut>')} post<!$Scr_Cs::0>`,
    },
    { title: 'Partial link', text: `E ${link(target, '<$custom:Shortcut')}> end` },
    { title: 'Own value', custom: { shortcut: 'Own-\\"' }, text: 'F <$custom:Shortcut> end' },
    { title: 'Include by name', text: 'G <$include:Included> end' },
    {
      title: 'Replacement on a style prefix',
      styles: ['Marked'],
      text: 'I <$Scr_Cs::0>marked<!$Scr_Cs::0> and typed [[ too',
    },
    {
      title: 'Replacement in a table cell',
      text: `J${PARA}${table([
        [{ text: 'Menu' }, { text: 'Purpose' }],
        [{ text: 'Scrivener' }, { text: '<$gone> The main menu' }],
      ])}${PLAIN}after`,
    },
    {
      title: 'Footnote include',
      text: `H${footnote(link(`scrivlnk://${TWO_PARAGRAPHS}`, '<$include>'))} end`,
    },
  ],
};
