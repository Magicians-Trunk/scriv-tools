/**
 * The order fixture: when placeholders are evaluated around replacements.  A replacement turns
 * `<$custom:shortcut>` (the field's ID) into `<$custom:MacShortcut>` (its title), and a later one
 * replaces the `\"` in the value.  Scrivener finds a field by its ID before the replacements and
 * by its title only after them, and evaluates the layout's title prefix, title suffix and section
 * prefix after them too.
 */
import type { ProjectSpec } from './project-builder.ts';
import { PARA, link, rtfDocument } from './rtf-builder.ts';

const TARGET = 'A2000000-0000-4000-8000-000000000001';
const OTHER = 'A2000000-0000-4000-8000-000000000002';
const target = (text: string) => link(`scrivlnk://${TARGET}`, text);

/** A format character style written between braces. */
const braces = (name: string, id: string) =>
  `<Style Name="${name}" ID="${id}" Type="Char"><Format/><Prefix>{</Prefix><Suffix>}</Suffix></Style>`;

export const order: ProjectSpec = {
  title: 'Order Fixture',
  customFields: [{ id: 'shortcut', title: 'MacShortcut' }],
  characterStyles: ['Interface Labels', 'Interface (Mac)', 'Mac-Only Text'],
  formats: [
    {
      name: 'Fixture Order',
      id: 'F4000000-0000-4000-8000-000000000001',
      replacements:
        '<Replacements><Replacement><Replace><![CDATA[<$custom:shortcut>]]></Replace><With><![CDATA[<$custom:MacShortcut>]]></With></Replacement>' +
        '<Replacement RegEx="Yes"><Replace><![CDATA[(?<!\\d)\\\\"]]></Replace><With><![CDATA[QUOTE]]></With></Replacement></Replacements>',
      styles:
        braces('Interface Labels', 'F4000000-0000-4000-8000-000000000010') +
        braces('Interface (Mac)', 'F4000000-0000-4000-8000-000000000011'),
      layoutSettings: {
        'Text Section with Heading':
          '<Titles><Prefix>[&lt;$custom:MacShortcut&gt;] </Prefix><Suffix> [&lt;$custom:shortcut&gt;]</Suffix></Titles>' +
          `<Prefix><![CDATA[${rtfDocument(`prefix [<$custom:MacShortcut>]${PARA}`)}]]></Prefix>`,
      },
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
    {
      id: OTHER,
      title: 'Other',
      text: 'Other text.',
      custom: { shortcut: 'Opt-Cmd-=' },
      include: false,
    },
    { title: 'Plain link', text: `A ${target('<$custom:shortcut>')} end` },
    {
      title: 'Labels in the link',
      styles: ['Interface Labels'],
      text: `B ${target('<$Scr_Cs::0><$custom:shortcut>')}<!$Scr_Cs::0> end`,
    },
    {
      title: 'Mac style in the link',
      styles: ['Interface (Mac)'],
      text: `C ${target('<$Scr_Cs::0><$custom:shortcut>')}<!$Scr_Cs::0> end`,
    },
    {
      title: 'Labels in a Mac-only run',
      styles: ['Mac-Only Text', 'Interface Labels'],
      text: `D <$Scr_Cs::0>pre ${target('<!$Scr_Cs::0><$Scr_Cs::1><$custom:shortcut>')}<!$Scr_Cs::1><$Scr_Cs::0> post<!$Scr_Cs::0>`,
    },
    {
      title: 'Mac style in a Mac-only run',
      styles: ['Mac-Only Text', 'Interface (Mac)'],
      text: `E <$Scr_Cs::0>pre ${target('<!$Scr_Cs::0><$Scr_Cs::1><$custom:shortcut>')}<!$Scr_Cs::1><$Scr_Cs::0> post<!$Scr_Cs::0>`,
    },
    {
      title: 'Two links in a Mac-only run',
      styles: ['Mac-Only Text', 'Interface (Mac)'],
      text:
        `F <$Scr_Cs::0>pre ${link(`scrivlnk://${OTHER}`, '<!$Scr_Cs::0><$Scr_Cs::1><$custom:shortcut>')}<!$Scr_Cs::1><$Scr_Cs::0>` +
        ` and ${target('<!$Scr_Cs::0><$Scr_Cs::1><$custom:shortcut>')}<!$Scr_Cs::1><$Scr_Cs::0> post<!$Scr_Cs::0>`,
    },
    {
      title: 'Own value by ID',
      custom: { shortcut: 'Own-\\"' },
      text: 'G <$custom:shortcut> end',
    },
    {
      title: 'Own value by title',
      custom: { shortcut: 'Own-\\"' },
      text: 'H <$custom:MacShortcut> end',
    },
  ],
};
