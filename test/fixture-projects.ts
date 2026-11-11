/** The fixture projects in `test/fixtures`, as `make-fixture.ts` builds them. */
import type { ItemSpec } from './binder-items.ts';
import type { ProjectSpec } from './project-builder.ts';
import { customFields } from './custom-fields-project.ts';
import { followups } from './followups-project.ts';
import { leftovers } from './leftovers-project.ts';
import { links } from './links-project.ts';
import { media } from './media-project.ts';
import { order } from './order-project.ts';
import { outstanding } from './outstanding-project.ts';
import { rawMarkup } from './raw-markup-project.ts';
import { shortcutLinks } from './shortcut-links-project.ts';
import { boundaries } from './boundaries-project.ts';
import { spacing } from './spacing-project.ts';
import { titleLinks } from './title-links-project.ts';
import {
  APOSTROPHE,
  BULLET,
  type Cell,
  ELLIPSIS,
  EM_DASH,
  LIST,
  PARA,
  PLAIN,
  QUOTE_CLOSE,
  QUOTE_OPEN,
  codeSpan,
  rtfDocument,
  listItem,
  table,
} from './rtf-builder.ts';

const lines = (...paragraphs: string[]) => paragraphs.join(PARA);

/** A table between a line of text and a line of more, as most table fixtures have it. */
const between = (rows: Cell[][]) => `Text${PARA}${table(rows)}${PLAIN}More`;

const basic: ProjectSpec = {
  title: 'Basic Fixture',
  formats: [{ name: 'Fixture MultiMarkdown', id: '5E1B7C42-8D3A-4F6B-9C21-7A0E4D9B3F11' }],
  items: [
    {
      type: 'Folder',
      title: 'Part One',
      children: [
        {
          title: 'Chapter One',
          text: lines(
            `It${APOSTROPHE}s a ${QUOTE_OPEN}quoted${QUOTE_CLOSE} line ${EM_DASH} with two  spaces${ELLIPSIS}`,
            'Second paragraph.',
          ),
        },
        {
          styles: ['Code Span'],
          text: lines('Untitled first line', `Run ${codeSpan(0, 'make check')} now.`),
        },
        {
          title: 'Chapter Two',
          styles: ['Block Quote'],
          text:
            `Before the list${PARA}${LIST}` +
            listItem(1, 0, BULLET, 'First item') +
            listItem(1, 0, BULLET, 'Second item') +
            `${PLAIN}After the list${PARA}${LIST}` +
            listItem(2, 0, '1.', 'One') +
            listItem(2, 0, '2.', 'Two') +
            `${PLAIN}<$Scr_Ps::0>A quoted line${PARA}<!$Scr_Ps::0>End.`,
          children: [
            { title: 'Section A', text: 'Deep text.' },
            {
              type: 'Folder',
              title: 'Deep Folder',
              children: [{ title: 'Deepest', text: 'Bottom.' }],
            },
          ],
        },
      ],
    },
    { type: 'Folder', title: 'Part Two' },
    { title: 'Left Out', include: false, text: 'Not compiled.' },
  ],
};

/** A `<Replacements>` element: each is `[replace, with, attributes]`. */
function replacements(...entries: [string, string, string?][]): string {
  const items = entries.map(
    ([from, to, attributes]) =>
      `<Replacement${attributes ? ` ${attributes}` : ''}><Replace><![CDATA[${from}]]></Replace><With><![CDATA[${to}]]></With></Replacement>`,
  );
  return `<Replacements>${items.join('')}</Replacements>`;
}

const replacementsProject: ProjectSpec = {
  title: 'Replacements Fixture',
  metadata: { Note: 'alpha note' },
  replacements: replacements(
    ['Colour', 'color'],
    ['Teh', 'The', 'CaseSensitive="Yes"'],
    ['skip', 'SKIPPED', 'Ignore="Yes"'],
    ['<<em:$@>>', '*$@*'],
    ['alpha', 'beta'],
  ),
  formats: [
    {
      name: 'Fixture Replacements',
      id: '6F2C8D53-9E4B-4A7C-8D32-8B1F5EAC4A22',
      layoutSettings: {
        Heading: `<Prefix><![CDATA[${rtfDocument(`alpha prefix${PARA}`)}]]></Prefix>`,
      },
      replacements: replacements(
        ['beta', 'gamma'],
        ['%%proj', '<$projecttitle>'],
        [String.raw`(\d+)px`, '$1 pixels', 'RegEx="Yes"'],
        ['“', '<<'],
      ),
    },
  ],
  items: [
    {
      type: 'Folder',
      title: 'Colour Folder',
      children: [
        {
          title: 'Colour Title',
          text: lines(
            'Colour colour COLOUR.',
            'Teh teh.',
            'skip this.',
            '<<em:word>> and <<em:two words>> and <<em:>>.',
            'alpha.',
            '10px and 3PX.',
            '%%proj',
            `${QUOTE_OPEN}quoted${QUOTE_CLOSE}`,
          ),
        },
      ],
    },
    { text: lines('alpha first line', 'plain') },
  ],
};

const placeholders: ProjectSpec = {
  title: 'Placeholders Fixture',
  authors: ['Ada Lovelace'],
  formats: [{ name: 'Fixture Placeholders', id: '7A3D9E64-AF5C-4B8D-9E43-9C2A6FBD5B33' }],
  items: [
    {
      type: 'Folder',
      title: 'Part One',
      children: [
        {
          title: 'Chapter One',
          label: '4',
          status: '5',
          synopsis: 'A synopsis line',
          text: lines(
            'n: <$n>, <$n>, <$n>',
            'sn: <$n> (<$sn>, <$sn>), <$n> (<$sn>)',
            'r R l L: <$r> <$r> <$R> <$l> <$l> <$L>',
            'w W t: <$w> <$w> <$W> <$t>',
            'rst: <$w>, <$rst><$w>, <$rst_n><$n>',
            'named: <$n:fig> <$n:fig> <$n#fig> <$n:tab> <$n:figure:a> <$n:figure:b> <$n:figure:a>',
            'vars: <$title>|<$parenttitle>|<$title_no_spaces>|<$parenttitle_no_spaces>|<$level1_title>|<$level2_title>|<$position>|<$parentposition>|<$label>|<$status>|<$synopsis>|<$subDocCount>|<$descendantCount>',
            'dates: <$createdDate:yyyy-MM-dd> <$modifiedDate:yyyy-MM-dd HH:mm>',
            'user: <$forename>|<$surname>|<$initial>|<$fullname>|<$FULLNAME>|<$compilegroup>|<$draftname>|<$PROJECTTITLE>|<$abbr_title>',
            // RTF escapes each backslash: one before the first tag, two before the second.
            'escape: \\\\<$n> and \\\\\\\\<$n>',
          ),
        },
        {
          title: 'Chapter Two',
          text: 'n <$n>, pos <$position> of <$parenttitle>',
          children: [
            {
              title: 'Section A',
              text: '<$level1_title> / <$level2_title> / <$title>, pos <$position>, parent pos <$parentposition>',
            },
          ],
        },
      ],
    },
    { title: 'Loose', text: '<$parenttitle>|<$level1_title>|<$position>|<$subDocCount>' },
  ],
};

const numbering: ProjectSpec = {
  title: 'Hierarchical Numbering Fixture',
  authors: ['Ada Lovelace'],
  formats: [{ name: 'Fixture Numbering', id: '8B4EAF75-B06D-4C9E-AF54-AD3B7ACE6C44' }],
  items: [
    {
      type: 'Folder',
      title: 'Part One',
      children: [
        { title: 'Ch A', text: 'A <$hn>' },
        {
          title: 'Ch B',
          text: 'B <$hn> again <$hn>',
          children: [
            { title: 'Sec B1', text: 'B1 <$hn>' },
            { title: 'Sec B2', text: 'B2 has no tag' },
            { title: 'Sec B3', text: 'B3 <$hn>' },
          ],
        },
        { title: 'Ch C', text: 'C <$hn>' },
      ],
    },
    { type: 'Folder', title: 'Part Two', children: [{ title: 'Ch D', text: 'D <$hn>' }] },
    { title: 'Loose', text: 'Loose <$hn>' },
  ],
};

const tables: ProjectSpec = {
  title: 'Tables Fixture',
  formats: [{ name: 'Fixture Tables', id: '9C5FB086-C17E-4DAF-B065-BE4C8BDF7D55' }],
  items: [
    {
      type: 'Folder',
      title: 'Tables',
      children: [
        {
          title: 'Simple Table',
          styles: ['Code Span'],
          text: `Before the table${PARA}${table(
            [
              [{ text: 'Name' }, { text: 'Value', align: 'qc' }, { text: 'Notes', align: 'qr' }],
              [{ text: 'alpha' }, { text: codeSpan(0, 'x = 1') }, { text: '' }],
              [{ text: 'beta' }, { text: '2' }, { text: 'two  spaces' }],
            ],
            2880,
          )}${PLAIN}After the table`,
        },
        {
          title: 'Merged Table',
          styles: ['Caption'],
          text: `Intro${PARA}${table(
            [
              [{ text: 'Merged header', align: 'qc', merge: 'first' }, { merge: 'rest' }],
              [{ text: 'left' }, { text: 'right' }],
            ],
            2880,
          )}${PLAIN}<$Scr_Ps::0>Table caption${PARA}<!$Scr_Ps::0>Closing line`,
        },
      ],
    },
  ],
};

/** A table of cells named by text, each row a list of `[text, alignment]`. */
const grid = (...rows: [string, Cell['align']?][][]) =>
  table(rows.map((row) => row.map(([text, align]) => (align ? { text, align } : { text }))));

/** One document per case, each a table alone. */
const cases = (entries: [string, string][]): ItemSpec[] => [
  {
    type: 'Folder',
    title: 'Alignment',
    children: entries.map(([title, text]) => ({ title, text: text + PLAIN })),
  },
];

const tables2: ProjectSpec = {
  title: 'More Tables Fixture',
  formats: [{ name: 'Fixture More Tables', id: 'AD60C197-D28F-4EB0-A176-CF5D9CE08E66' }],
  items: [
    {
      type: 'Folder',
      title: 'More Tables',
      children: [
        {
          title: 'Four Columns',
          text: between([
            [{ text: 'H1' }, { text: 'H2' }, { text: 'H3' }, { text: 'H4' }],
            [{ text: 'a1' }, { text: 'a2' }, { text: 'a3' }, { text: 'a4' }],
            [{ text: 'b1' }, { text: 'b2' }, { text: 'b3' }, { text: 'b4' }],
          ]),
        },
        {
          title: 'One Column',
          text: between([[{ text: 'Only' }], [{ text: 'x' }], [{ text: 'y' }]]),
        },
        {
          title: 'Body Merge',
          text: between([
            [{ text: 'Head A' }, { text: 'Head B' }],
            [{ text: 'Spans both', merge: 'first' }, { merge: 'rest' }],
            [{ text: 'c1' }, { text: 'c2' }],
          ]),
        },
        {
          title: 'Header Merge',
          text: between([
            [
              { text: 'Wide', align: 'qc', merge: 'first' },
              { merge: 'rest' },
              { text: 'Third', align: 'qr' },
            ],
            [{ text: 'r1', align: 'qc' }, { text: 'r2' }, { text: 'r3', align: 'qr' }],
            [{ text: 's1' }, { text: 's2' }, { text: 's3' }],
          ]),
        },
        { title: 'Alone', text: grid([['Solo'], ['Table']], [['1'], ['2']]) + PLAIN },
        {
          title: 'Caption Above',
          styles: ['Caption'],
          text: `Text${PARA}<$Scr_Ps::0>Caption first${PARA}<!$Scr_Ps::0>${grid([['Solo'], ['Table']], [['1'], ['2']])}${PLAIN}More`,
        },
      ],
    },
  ],
};

const alignment: ProjectSpec = {
  title: 'Alignment Fixture',
  formats: [{ name: 'Fixture Alignment', id: 'BE71D2A8-E39F-4FC1-B287-DF6EADF19F77' }],
  items: cases([
    ['One C over L', grid([['H', 'qc']], [['a']], [['b']])],
    ['One R over L', grid([['H', 'qr']], [['a']], [['b']])],
    ['One L over C', grid([['H']], [['a', 'qc']], [['b', 'qc']])],
    ['One L over R', grid([['H']], [['a', 'qr']], [['b', 'qr']])],
    [
      'Two C over L',
      grid(
        [
          ['H1', 'qc'],
          ['H2', 'qc'],
        ],
        [['a1'], ['a2']],
        [['b1'], ['b2']],
      ),
    ],
    [
      'Two R over L',
      grid(
        [
          ['H1', 'qr'],
          ['H2', 'qr'],
        ],
        [['a1'], ['a2']],
        [['b1'], ['b2']],
      ),
    ],
    [
      'Three L C R over L',
      grid(
        [['H1'], ['H2', 'qc'], ['H3', 'qr']],
        [['a1'], ['a2'], ['a3']],
        [['b1'], ['b2'], ['b3']],
      ),
    ],
    [
      'Three R C L over L',
      grid(
        [['H1', 'qr'], ['H2', 'qc'], ['H3']],
        [['a1'], ['a2'], ['a3']],
        [['b1'], ['b2'], ['b3']],
      ),
    ],
    [
      'Three R R R over L',
      grid(
        [
          ['H1', 'qr'],
          ['H2', 'qr'],
          ['H3', 'qr'],
        ],
        [['a1'], ['a2'], ['a3']],
      ),
    ],
    [
      'Mixed body',
      grid(
        [
          ['H1', 'qc'],
          ['H2', 'qc'],
        ],
        [['a1', 'qc'], ['a2']],
        [['b1'], ['b2', 'qc']],
        [
          ['c1', 'qr'],
          ['c2', 'qr'],
        ],
      ),
    ],
    [
      'Empty and spaced',
      grid(
        [['H1'], ['H2', 'qc'], ['H3', 'qr']],
        [['a1'], [''], ['']],
        [['b1'], ['two  sp'], ['x y']],
      ),
    ],
    [
      'Merged C over L L',
      table([
        [{ text: 'Wide', align: 'qc', merge: 'first' }, { merge: 'rest' }],
        [{ text: 'l1' }, { text: 'r1' }],
        [{ text: 'l2' }, { text: 'r2' }],
      ]),
    ],
    [
      'Merged L over L L',
      table([
        [{ text: 'Wide', merge: 'first' }, { merge: 'rest' }],
        [{ text: 'l1' }, { text: 'r1' }],
      ]),
    ],
  ]),
};

/** A header row aligned right in the given columns, over one row aligned left. */
function rightAt(columns: number, ...right: number[]): string {
  const header = Array.from({ length: columns }, (_, n): [string, Cell['align']?] => [
    `H${n + 1}`,
    right.includes(n) ? 'qr' : undefined,
  ]);
  return grid(
    header,
    Array.from({ length: columns }, (_, n): [string] => [`a${n + 1}`]),
  );
}

const alignment2: ProjectSpec = {
  title: 'Alignment Two Fixture',
  formats: [{ name: 'Fixture Alignment Two', id: 'CF82E3B9-F4A0-40D2-C398-E07FBE020A88' }],
  items: cases([
    ['Five R', rightAt(5, 0, 1, 2, 3, 4)],
    [
      'Five C',
      grid(
        [1, 2, 3, 4, 5].map((n): [string, Cell['align']] => [`H${n}`, 'qc']),
        [1, 2, 3, 4, 5].map((n): [string] => [`a${n}`]),
      ),
    ],
    ['Four R at 2 3', rightAt(4, 2, 3)],
    ['Four R at 1 3', rightAt(4, 1, 3)],
    ['Four R at 0 3', rightAt(4, 0, 3)],
    ['Four R at 1 2', rightAt(4, 1, 2)],
    ['Four R at 3', rightAt(4, 3)],
    ['Four R at 2', rightAt(4, 2)],
    ['Four R at 0 1 2', rightAt(4, 0, 1, 2)],
    ['Six R at 1 2 3 4 5', rightAt(6, 1, 2, 3, 4, 5)],
  ]),
};

const NOTES_LAYOUTS = [
  { name: 'Everything', include: 'Titles="Yes" Synopses="Yes" Notes="Yes" Text="Yes"' },
  { name: 'Synopsis and Text', include: 'Synopses="Yes" Text="Yes"' },
  { name: 'Notes and Text', include: 'Notes="Yes" Text="Yes"' },
  { name: 'Synopsis Only', include: 'Synopses="Yes"' },
];
const NOTES_ASSIGN = {
  Heading: 'Everything',
  Section: 'Everything',
  'Synopsis and Text': 'Synopsis and Text',
  'Notes and Text': 'Notes and Text',
  'Synopsis Only': 'Synopsis Only',
};
const notesOptions = (subtitles: string, notesBefore: string) =>
  `<FormattingOptions><NotesBeforeText>${notesBefore}</NotesBeforeText><IncludeSubtitles>${subtitles}</IncludeSubtitles></FormattingOptions>`;

const notes: ProjectSpec = {
  title: 'Notes Fixture',
  authors: ['Ada Lovelace'],
  sectionTypes: ['Synopsis and Text', 'Notes and Text', 'Synopsis Only'],
  formats: [
    {
      name: 'Fixture Notes After',
      id: 'F1000000-0000-4000-8000-000000000001',
      layouts: NOTES_LAYOUTS,
      assign: NOTES_ASSIGN,
      formattingOptions: notesOptions('Yes', 'No'),
    },
    {
      name: 'Fixture Notes Before',
      id: 'F1000000-0000-4000-8000-000000000002',
      layouts: NOTES_LAYOUTS,
      assign: NOTES_ASSIGN,
      formattingOptions: notesOptions('No', 'Yes'),
    },
  ],
  items: [
    {
      type: 'Folder',
      title: 'Part One',
      synopsis: 'Part synopsis',
      notes: 'Part notes',
      children: [
        {
          title: 'Chapter A',
          synopsis: 'Syn A',
          notes: lines('Note A one', 'Note A two'),
          text: 'Body A',
        },
        {
          title: 'Chapter B',
          section: 'Synopsis and Text',
          synopsis: 'Syn B1\nSyn B2',
          text: 'Body B',
        },
        {
          title: 'Chapter C',
          section: 'Notes and Text',
          notes: `It${APOSTROPHE}s a note`,
          text: 'Body C',
        },
        {
          title: 'Chapter D',
          section: 'Synopsis Only',
          synopsis: 'Syn D',
          text: 'Body D is left out',
        },
        { title: 'Chapter E', text: 'Body E with no synopsis or notes' },
        { synopsis: 'Untitled synopsis', notes: 'Untitled notes', text: 'Untitled body' },
      ],
    },
  ],
};

export const FIXTURES: Record<string, ProjectSpec> = {
  boundaries,
  basic,
  replacements: replacementsProject,
  placeholders,
  numbering,
  tables,
  tables2,
  alignment,
  alignment2,
  notes,
  outstanding,
  links,
  spacing,
  order,
  'title-links': titleLinks,
  'raw-markup': rawMarkup,
  leftovers,
  'shortcut-links': shortcutLinks,
  followups,
  'custom-fields': customFields,
};

/** Fixtures waiting for Scrivener's compile: `make-fixture.ts` builds them, the tests skip them. */
export const PENDING_FIXTURES: Record<string, ProjectSpec> = { media };
