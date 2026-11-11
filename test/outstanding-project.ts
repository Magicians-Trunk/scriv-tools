/** The outstanding fixture: compile settings checked one feature at a time against Scrivener. */
import type { ItemSpec } from './binder-items.ts';
import type { LayoutSpec, ProjectSpec } from './project-builder.ts';
import {
  BULLET,
  CIRCLE,
  LINE,
  LIST,
  PARA,
  PLAIN,
  annotation,
  footnote,
  link,
  listItem,
  preserved,
  rtfDocument,
  struck,
  table,
} from './rtf-builder.ts';

const STATS_ID = 'A0000000-0000-4000-8000-000000000002';
const COMMENT_ID = 'C0000000-0000-4000-8000-000000000001';
const STYLE_FORMAT = `<Format><![CDATA[${rtfDocument('Attributes')}]]></Format>`;
const USE_DEFAULT = '<Separators UseDefault="Yes"/>';

const titles = (settings: string) => `<Titles>${settings}</Titles>`;
const rtfField = (text: string) => `<![CDATA[${rtfDocument(text)}]]>`;
const separators = (before: string, between: string, after: string) =>
  `<Separators UseDefault="No">${before}${between}${after}</Separators>`;
const NO_OVERRIDE = '<AfterOverride Use="No" Type="Single"/>';

/** Each layout and its section type share a name. */
const LAYOUTS: LayoutSpec[] = [
  { name: 'Metadata', include: 'Titles="Yes" MetaData="Yes" Text="Yes"' },
  {
    name: 'Title Prefix',
    include: 'Titles="Yes" Text="Yes"',
    settings: titles('<Prefix>Chapter &lt;$n:chapter&gt;: </Prefix><Suffix> (end)</Suffix>'),
  },
  {
    name: 'Two Hashes',
    include: 'Titles="Yes" Text="Yes"',
    settings: titles('<MMDHashCount>2</MMDHashCount>'),
  },
  {
    name: 'No Hashes',
    include: 'Titles="Yes" Text="Yes"',
    settings: titles('<MMDHashCount>0</MMDHashCount><Prefix>[</Prefix><Suffix>]</Suffix>'),
  },
  {
    name: 'Uppercase',
    include: 'Titles="Yes" Text="Yes"',
    settings: titles('<TitleCase>Uppercase</TitleCase>'),
  },
  {
    name: 'Run In',
    include: 'Titles="Yes" Text="Yes"',
    settings: titles('<RunInHead>Yes</RunInHead><Suffix>. </Suffix>'),
  },
  {
    name: 'Hashes Inside',
    include: 'Titles="Yes" Text="Yes"',
    settings: titles('<Prefix>&gt; </Prefix><Suffix HashesInside="Yes"> &lt;</Suffix>'),
  },
  {
    name: 'Page Break',
    include: 'Titles="Yes" Text="Yes"',
    separators: separators(
      '<Before Type="PageBreak"/>',
      '<Between Type="PageBreak"/>',
      NO_OVERRIDE,
    ),
  },
  {
    name: 'Custom Break',
    include: 'Titles="Yes" Text="Yes"',
    separators: separators(
      '<Before Type="Custom">@ Before @</Before>',
      '<Between Type="Custom">@ Between @</Between>',
      NO_OVERRIDE,
    ),
  },
  {
    name: 'After Override',
    include: 'Titles="Yes" Text="Yes"',
    separators: separators(
      '<Before Type="Single"/>',
      '<Between Type="Single"/>',
      '<AfterOverride Use="Yes" Type="PageBreak"/>',
    ),
  },
  { name: 'Padding', include: 'Titles="Yes" Text="Yes"', settings: '<PagePadding>2</PagePadding>' },
  {
    name: 'Upper Words',
    include: 'Titles="Yes" Text="Yes"',
    settings: '<UppercasedFirstWords>2</UppercasedFirstWords>',
  },
  {
    name: 'Placement',
    include: 'Titles="Yes" Text="Yes"',
    settings:
      `<Prefix AfterTitle="Yes">${rtfField(`[prefix after title]${PARA}`)}</Prefix>` +
      `<Suffix AfterSubdocs="Yes">${rtfField(`${PARA}[suffix after subdocuments]`)}</Suffix>`,
  },
  {
    name: 'Blank Lines',
    include: 'Titles="Yes" Text="Yes"',
    settings: '<BlankLineSeparator SkipStyles="Yes">* * *</BlankLineSeparator>',
  },
];

/** The layouts checked with a child document of the same section type. */
const WITH_CHILD = new Set(['Page Break', 'Custom Break', 'After Override', 'Placement']);

const numberingFolder = (tag: string): ItemSpec => ({
  type: 'Folder',
  title: `Numbering ${tag}`,
  children: [
    {
      title: `${tag} one`,
      text: `${tag} <$${tag}>`,
      children: [{ title: `${tag} deep`, text: `${tag} <$${tag}>` }],
    },
    { title: `${tag} two`, text: `${tag} <$${tag}>` },
    { title: `${tag} plain`, text: 'no tag' },
    { title: `${tag} three`, text: `${tag} <$${tag}>` },
  ],
});

const placeholders: ItemSpec = {
  id: 'A0000000-0000-4000-8000-000000000001',
  type: 'Folder',
  title: 'Placeholders',
  children: [
    {
      title: 'Dates now',
      text: [
        'year <$year> | iso <$date:yyyy-MM-dd>',
        'short <$shortdate> | medium <$mediumdate> | long <$longdate> | full <$fulldate>',
        'month <$month> <$shortmonth> <$numericalmonth> <$shortnumericalmonth> | day <$day> <$longday> | weekday <$weekday> <$shortweekday>',
      ].join(PARA),
    },
    {
      title: 'Binder dates',
      text: [
        'created <$createdDate> | <$shortCreatedDate> | <$mediumCreatedDate> | <$longCreatedDate> | <$fullCreatedDate>',
        'times <$createdTime> | <$mediumCreatedTime> | modified <$modifiedDate>',
      ].join(PARA),
    },
    {
      id: STATS_ID,
      title: 'Stats',
      text: 'words <$wc> <$wc100> chars <$cc> <$cc100> docs <$doccount> link <$linkID>',
    },
  ],
};

const text: ItemSpec = {
  type: 'Folder',
  title: 'Text',
  children: [
    {
      title: 'Nested lists',
      text:
        `Before${PARA}${LIST}` +
        listItem(1, 0, BULLET, 'one') +
        listItem(1, 1, CIRCLE, 'one inner') +
        listItem(1, 1, CIRCLE, 'two inner') +
        listItem(1, 0, BULLET, 'two') +
        listItem(2, 0, '1.', 'first') +
        listItem(2, 1, 'a.', 'first inner') +
        listItem(2, 0, '2.', 'second') +
        `${PLAIN}After`,
    },
    {
      title: 'Line breaks',
      text: `one${LINE}two${LINE}three${PARA}${LIST}${listItem(1, 0, BULLET, `item${LINE}continued`)}${PLAIN}After`,
    },
    { title: 'Footnotes kept', text: `Text with a note${footnote('the footnote')} and more.` },
    { title: 'Annotations kept', text: `Text ${annotation('an annotation')} more.` },
    {
      title: 'Comments kept',
      comment: { id: COMMENT_ID, text: 'the comment text' },
      text: `Some ${link(`scrivcmt://${COMMENT_ID}`, 'commented words')} here.`,
    },
    { title: 'Preserve formatting', text: `Raw ${preserved('*kept as typed*')} done.` },
    { title: 'Struck text', text: `keep ${struck('gone')} kept` },
    {
      title: 'Links',
      text: `Web ${link('https://example.com/page', 'example')} and doc ${link(`scrivlnk://${STATS_ID}`, 'the stats')}.`,
    },
    {
      title: 'Heading on list item',
      styles: ['Heading 2'],
      text: `Intro${PARA}${LIST}${listItem(1, 0, BULLET, '<$Scr_Ps::0>Streaming Service')}${PLAIN}<!$Scr_Ps::0>After`,
    },
    {
      title: 'Deleted style',
      styles: ['Delete Me'],
      text: `Kept line${PARA}<$Scr_Ps::0>This line is deleted${PARA}<!$Scr_Ps::0>Also kept`,
    },
    { title: 'Filtered out', label: '4', text: 'This document has the Blue label.' },
  ],
};

const tables: ItemSpec = {
  type: 'Folder',
  title: 'Tables',
  children: [
    {
      title: 'Vertical merge',
      text:
        table([
          [{ text: 'H1' }, { text: 'H2' }],
          [{ text: 'tall', merge: 'top' }, { text: 'r1' }],
          [{ text: '', merge: 'below' }, { text: 'r2' }],
        ]) + PLAIN,
    },
    {
      title: 'Two paragraph cell',
      text:
        table([
          [{ text: 'H1' }, { text: 'H2' }],
          [{ text: `line one${PARA}line two` }, { text: 'b' }],
        ]) + PLAIN,
    },
    {
      title: 'Justified cell',
      text:
        table([
          [{ text: 'H1' }, { text: 'H2' }],
          [{ text: 'j', align: 'qj' }, { text: 'b' }],
        ]) + PLAIN,
    },
    {
      title: 'Uneven rows',
      text:
        table([
          [{ text: 'H1' }, { text: 'H2' }, { text: 'H3' }],
          [{ text: 'a' }, { text: 'b' }],
        ]) + PLAIN,
    },
  ],
};

const layouts: ItemSpec = {
  type: 'Folder',
  title: 'Layouts',
  children: [
    ...LAYOUTS.map(({ name }) => ({
      title: name,
      section: name,
      text:
        name === 'Blank Lines'
          ? `Body of ${name}${PARA}${PARA}after a blank line`
          : `Body of ${name}`,
      children: WITH_CHILD.has(name)
        ? [{ title: `${name} child`, section: name, text: `Child of ${name}` }]
        : [],
    })),
    {
      title: 'Metadata labelled',
      section: 'Metadata',
      label: '2',
      status: '3',
      text: 'Has label and status',
    },
  ],
};

const formatStyle = (name: string, type: string, settings: string) =>
  `<Style Name="${name}" ID="C1D2E3F4-0000-4000-8000-0000000000${name === 'Heading 2' ? '10' : '11'}" Type="${type}">${STYLE_FORMAT}${settings}</Style>`;

export const outstanding: ProjectSpec = {
  title: 'Outstanding Fixture Title',
  abbreviatedTitle: 'Outstanding Fixture Abbrv Title',
  authors: ['First Author', 'Second Author'],
  forename: 'Forename Field',
  surname: 'Surname Field',
  sectionTypes: LAYOUTS.map(({ name }) => name),
  projectStyles: ['Delete Me'],
  excludeLabel: '4',
  options: {
    removeComments: undefined,
    removeAnnotations: undefined,
    deleteStruckThroughText: true,
    convertLinksToMmd: true,
  },
  formats: [
    {
      name: 'Fixture Outstanding',
      id: 'F2000000-0000-4000-8000-000000000001',
      layouts: [
        { name: 'Plain', include: 'Titles="Yes" Text="Yes"', separators: USE_DEFAULT },
        { name: 'Heading', include: 'Titles="Yes"', separators: USE_DEFAULT },
        ...LAYOUTS.map((layout) => ({ separators: USE_DEFAULT, ...layout })),
      ],
      assign: {
        Heading: 'Heading',
        Section: 'Plain',
        ...Object.fromEntries(LAYOUTS.map(({ name }) => [name, name])),
      },
      styles:
        formatStyle('Heading 2', 'Para+Char', '<Prefix><![CDATA[## ]]></Prefix>') +
        formatStyle('Delete Me', 'Para', '<DeleteText>Yes</DeleteText>'),
    },
  ],
  items: [
    placeholders,
    ...['ahn', 'aon', 'hn_0', 'hn_level1'].map(numberingFolder),
    text,
    tables,
    layouts,
  ],
  frontMatter: {
    id: 'A0000000-0000-4000-8000-000000000003',
    type: 'Folder',
    title: 'Front Matter',
    children: [{ title: 'Title page', text: 'Front matter page' }],
  },
};
