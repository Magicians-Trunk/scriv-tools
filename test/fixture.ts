import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { type CompileXml, compileXml, writeCompileXml } from '../src/compile-xml.ts';
import { readDocumentText } from '../src/document.ts';
import { type ProjectStyle, writeStyles } from '../src/project-styles.ts';
import { type Scrformat, writeScrformat } from '../src/scrformat.ts';
import { type SeparatorChoices } from '../src/scrformat-layouts.ts';
import { type Scrivx, scrivxFile, writeScrivx } from '../src/scrivx.ts';
import { newUnread } from '../src/xml-codec.ts';
import { readXml } from '../src/xml.ts';
import { binderItem, type ItemSpec } from './binder-items.ts';
import { rtfDocument } from './rtf-builder.ts';

export interface FixtureOptions {
  /** The Draft folder's children. */
  items: ItemSpec[];
  /** Items beside the Draft folder. */
  topLevel?: ItemSpec[];
  /** RTF body text of the Draft folder itself. */
  draftText?: string;
  /** Changes the project file from the fixture's. */
  scrivx?: (scrivx: Scrivx) => void;
  /** Changes the compile settings from the fixture's. */
  compile?: (settings: CompileXml) => void;
  /** Changes the compile format from the fixture's. */
  format?: (format: Scrformat) => void;
  /** Leaves out `Settings/compile.xml`. */
  neverCompiled?: boolean;
}

/** Fixture items name section types and styles by their IDs. */
const SAME_IDS = { section: (id: string) => id, style: (id: string) => id };

export const STYLES = {
  heading: 'S-HEADING',
  codeSpan: 'S-CODESPAN',
  codeBlock: 'S-CODEBLOCK',
  blockQuote: 'S-QUOTE',
  bullets: 'S-BULLETS',
  marked: 'S-MARKED',
};

/** A project style with no formatting of its own. */
const projectStyle = (name: string, id: string, type: string): ProjectStyle => ({
  name,
  id,
  type,
  format: readDocumentText(''),
});

const PROJECT_STYLES = [
  projectStyle('Heading 1', STYLES.heading, 'Para+Char'),
  projectStyle('Code Span', STYLES.codeSpan, 'Char'),
  projectStyle('Code Block', STYLES.codeBlock, 'Para+Char'),
  projectStyle('Block Quote', STYLES.blockQuote, 'Para'),
  projectStyle('Bullet List', STYLES.bullets, 'Para'),
  projectStyle('Marked', STYLES.marked, 'Para'),
];

/** The blank project Scrivener made, which every fixture's `.scrivx` starts from. */
const BLANK = path.join(import.meta.dirname, 'fixtures', 'blank.scriv', 'blank-scriv-doc.scrivx');

function fixtureScrivx(project: string, options: FixtureOptions): Scrivx {
  const draft: ItemSpec = {
    id: 'DRAFT',
    type: 'DraftFolder',
    title: 'Draft',
    children: options.items,
  };
  if (options.draftText !== undefined) draft.text = options.draftText;
  const scrivx = scrivxFile.read(readXml(BLANK, 'ScrivenerProject'), newUnread());
  scrivx.binder = [draft, ...(options.topLevel ?? [])].map((item) =>
    binderItem(project, item, SAME_IDS),
  );
  scrivx.labelSettings.labels = [
    { id: '-1', name: 'No Label' },
    { id: '1', name: 'Blue' },
  ];
  scrivx.statusSettings.statuses = [
    { id: '-1', name: 'No Status' },
    { id: '2', name: 'Done' },
  ];
  scrivx.customFields = [
    { id: 'targetfile', type: 'Text', title: 'TargetFile' },
    { id: 'ready', type: 'Checkbox', title: 'Ready' },
    {
      id: 'place',
      type: 'List',
      title: 'Place',
      listOptions: { none: 'Unassigned', options: [{ id: '1', name: 'Renderer' }] },
    },
  ];
  scrivx.sectionTypes = {
    definitions: [
      { id: 'T-HEADING', name: 'Heading' },
      { id: 'T-SECTION', name: 'Section' },
    ],
    levels: { folders: ['T-HEADING'], containers: ['T-SECTION'], files: ['T-SECTION'] },
  };
  options.scrivx?.(scrivx);
  return scrivx;
}

/** Compile settings Scrivener wrote, which every fixture's start from. */
const COMPILED = path.join(
  import.meta.dirname,
  'fixtures',
  'basic.scriv',
  'Settings',
  'compile.xml',
);

function fixtureCompileSettings(): CompileXml {
  const settings = compileXml.read(readXml(COMPILED, 'CompileSettings'), newUnread());
  const { projectSettings } = settings;
  projectSettings.content = {
    scope: 'Included',
    filter: { state: 'Off', exclude: false, type: 'Label' },
  };
  projectSettings.replacements = [];
  Object.assign(projectSettings.options, {
    removeComments: true,
    removeAnnotations: true,
    removeFootnotes: true,
    convertTablesAndListsToMmd: true,
  });
  projectSettings.metadata = {
    ...projectSettings.metadata,
    projectTitle: 'Fixture',
    abbreviatedTitle: 'Fix',
    mmd: [
      { key: 'Title', value: '<$projecttitle>' },
      { key: 'Author', value: '<$author>' },
    ],
  };
  settings.formats = [
    {
      id: 'FMT',
      sectionLayouts: [
        { typeId: 'T-HEADING', layoutId: 'L-HEADING' },
        { typeId: 'T-SECTION', layoutId: 'L-TEXT' },
      ],
    },
  ];
  settings.lastUsedFormats = { mmd: 'FMT' };
  return settings;
}

/** A layout prefix or suffix: RTF, as Scrivener stores it, read as a document. */
export const field = (body: string) => readDocumentText(rtfDocument(body));

/** Separators: before and between items of one kind, and the layout's own "after" one, unused. */
export const separators = (type: string): SeparatorChoices => ({
  before: { type, text: '' },
  between: { type, text: '' },
  afterOverride: { use: false, type: 'Single', text: '' },
});

function fixtureFormat(): Scrformat {
  return {
    name: 'Fixture Format',
    id: 'FMT',
    supportedTypes: ['mmd'],
    sectionLayouts: [
      {
        name: 'Heading',
        id: 'L-HEADING',
        include: { text: true },
        blankLineSeparator: { skipStyles: true, text: '' },
        prefix: { document: field('[<$title>]\\\n') },
        separators: { useDefault: true, ...separators('Single') },
      },
      {
        name: 'Text Section',
        id: 'L-TEXT',
        include: { text: true },
        prefix: { document: field('::: \\{file="<$custom:TargetFile>"\\}\\\n\\\n') },
        suffix: { document: field('\\\n\\\n:::') },
        separators: { useDefault: true, ...separators('Single') },
      },
    ],
    formattingOptions: { notesBeforeText: false, includeSubtitles: false },
    separatorSettings: {
      folderSeparators: separators('Single'),
      textSeparators: separators('Double'),
    },
    styles: [
      { name: 'Heading 1', id: 'F-HEADING', type: 'Para+Char', prefix: '# ' },
      { name: 'Code Span', id: 'F-CODESPAN', type: 'Char' },
      {
        name: 'Code Block',
        id: 'F-CODEBLOCK',
        type: 'Para+Char',
        rawMarkup: true,
        prefix: '```',
        suffix: '```',
      },
      { name: 'Block Quote', id: 'F-QUOTE', type: 'Para' },
      { name: 'Marked', id: 'F-MARKED', type: 'Para', paraPrefix: '| ' },
    ],
    transformations: {
      removeSmartPunctuation: true,
      plainTextConversion: { state: 'Off', conversion: 'Para' },
      underlineHyperlinks: true,
      outlineIndent: { state: 'Off', indent: '18.0' },
    },
    replacements: [],
    mmd: {
      metadata: [{ isProjectMetadataPlaceholder: true, value: '' }],
      blockQuoteStyleId: 'F-QUOTE',
      codeBlockStyleId: 'F-CODEBLOCK',
      codeSpanId: 'F-CODESPAN',
      latexDocumentClass: 'Memoir',
      usePandocSyntax: true,
    },
    postProcessing: { enabled: false },
  };
}

/** Nothing read, so nothing to refuse writing. */
const READ_WHOLE = { scrivx: newUnread(), styles: newUnread(), compileSettings: newUnread() };

/** Writes a fixture project into a new temporary folder and returns its `.scriv` path. */
export function writeFixture(options: FixtureOptions): string {
  const project = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-tools-')),
    'Fixture.scriv',
  );
  fs.mkdirSync(path.join(project, 'Files'), { recursive: true });
  fs.mkdirSync(path.join(project, 'Settings', 'Compile Formats'), { recursive: true });
  const scrivx = writeScrivx(fixtureScrivx(project, options));
  fs.writeFileSync(path.join(project, 'Fixture.scrivx'), scrivx);
  const styles = writeStyles({ styles: PROJECT_STYLES, unsupported: READ_WHOLE });
  fs.writeFileSync(path.join(project, 'Files', 'styles.xml'), styles);
  if (!options.neverCompiled) {
    const settings = fixtureCompileSettings();
    options.compile?.(settings);
    fs.writeFileSync(
      path.join(project, 'Settings', 'compile.xml'),
      writeCompileXml(settings, READ_WHOLE),
    );
  }
  const format = fixtureFormat();
  options.format?.(format);
  fs.writeFileSync(
    path.join(project, 'Settings', 'Compile Formats', 'Fixture-Format.scrformat'),
    writeScrformat(format),
  );
  return project;
}
