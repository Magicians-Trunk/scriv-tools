/**
 * The shortcut links fixture: the leftovers fixture reproduced manual line 2355 only in the
 * manual's whole paragraph run, where Scrivener evaluates the second link's field after the
 * replacements.  Each item here drops one piece of that run to find which piece does it.
 */
import type { ItemSpec } from './binder-items.ts';
import type { ProjectSpec } from './project-builder.ts';
import { PARA, link } from './rtf-builder.ts';

const TARGET = 'A8000000-0000-4000-8000-000000000001';
const OTHER = 'A8000000-0000-4000-8000-000000000002';

/** A link whose text is the shortcut placeholder in Interface Labels, style `index`. */
const shortcut = (target: string, index: number) =>
  `${link(`scrivlnk://${target}`, `<$Scr_Cs::${index}><$custom:shortcut>`)}<!$Scr_Cs::${index}>`;

/** The manual's run, less the pieces `drop` names. */
function run(name: string, drop: string[]): ItemSpec {
  const keep = (piece: string) => !drop.includes(piece);
  const styles = [
    ...(keep('caption style') ? ['Caption'] : []),
    ...(keep('list style') ? ['Bullet Indent'] : []),
    'Interface Labels',
  ];
  const at = (style: string) => styles.indexOf(style);
  const labels = at('Interface Labels');
  const paragraphs = [
    ...(keep('opening') ? [`${name} opening paragraph.`] : []),
    ...(keep('caption')
      ? [
          keep('caption style')
            ? `<$Scr_Ps::${at('Caption')}>A caption.${PARA}<!$Scr_Ps::${at('Caption')}>The buttons are:`
            : `A caption.${PARA}The buttons are:`,
        ]
      : []),
  ];
  const items = [
    ...(keep('first link') ? [`1. ${name} use ${shortcut(OTHER, labels)} first.`] : []),
    `2. ${name} use ${shortcut(TARGET, labels)}.`,
    ...(keep('third') ? [`3. ${name} closes the split.`] : []),
  ].join(PARA);
  const list = keep('list style')
    ? `<$Scr_Ps::${at('Bullet Indent')}>${items}<!$Scr_Ps::${at('Bullet Indent')}>`
    : items;
  return {
    title: drop.length === 0 ? 'Whole run' : `Without ${drop.join(', ')}`,
    styles,
    text: [...paragraphs, list].join(PARA),
  };
}

export const shortcutLinks: ProjectSpec = {
  title: 'Shortcut Links Fixture',
  customFields: [{ id: 'shortcut', title: 'MacShortcut' }],
  projectStyles: ['Bullet Indent', 'Caption'],
  characterStyles: ['Interface Labels'],
  formats: [
    {
      name: 'Fixture Shortcut Links',
      id: 'F8000000-0000-4000-8000-000000000001',
      replacements:
        '<Replacements><Replacement><Replace><![CDATA[<$custom:shortcut>]]></Replace><With><![CDATA[<$custom:MacShortcut>]]></With></Replacement>' +
        '<Replacement RegEx="Yes"><Replace><![CDATA[(?<=\\d)\\\\"]]></Replace><With><![CDATA[DIGITQUOTE]]></With></Replacement>' +
        '<Replacement RegEx="Yes"><Replace><![CDATA[(?<!\\d)\\\\"]]></Replace><With><![CDATA[QUOTE]]></With></Replacement></Replacements>',
      styles:
        '<Style Name="Interface Labels" ID="F8000000-0000-4000-8000-000000000010" Type="Char"><Format/><Prefix>{</Prefix><Suffix>}</Suffix></Style>',
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
    run('A', []),
    run('B', ['opening']),
    run('C', ['caption']),
    run('D', ['caption style']),
    run('E', ['third']),
    run('F', ['first link']),
    run('G', ['list style']),
    run('H', ['opening', 'caption']),
  ],
};
