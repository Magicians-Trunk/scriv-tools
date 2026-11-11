import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import type { ItemSpec } from '../test/binder-items.ts';
import type { Scrivx } from './scrivx.ts';
import { field, separators, STYLES, writeFixture, type FixtureOptions } from '../test/fixture.ts';
import { footnote, rtfDocument } from '../test/rtf-builder.ts';
import {
  type CompileOptions,
  compileModel,
  prepareCompile,
  readText,
  writeCompile,
} from './compile.ts';
import { type CompileFilesOptions, compileFiles, writeSections } from './compile-files.ts';
import { readFormatFile } from './compile-format.ts';
import { type CompileXml, type ContentFilter } from './compile-xml.ts';
import { readDocumentText } from './document.ts';
import { readModel } from './model.ts';
import {
  draftFolder,
  findItem,
  flatten,
  indexBinder,
  openProject,
  type Project,
} from './project.ts';
import { saveProject } from './save.ts';
import { type Scrformat, writeScrformat } from './scrformat.ts';
import type {
  FormattingSample,
  LayoutFormatting,
  LayoutInclude,
  LayoutTitles,
} from './scrformat-layouts.ts';

/** Opens and compiles in one go, with the format named, or the last one used. */
const compileProject = (project: Project, options: CompileOptions & { format?: string } = {}) =>
  compileModel(readModel(project, options.format), options);

const ITEMS: ItemSpec[] = [
  {
    id: 'PART',
    type: 'Folder',
    title: 'Part',
    children: [
      {
        id: 'INTRO',
        title: 'Intro',
        custom: { targetfile: 'intro.md' },
        text: "Hello \\'93world\\'94 \\emdash  fine\\'85 \\'96 it\\'92s",
      },
    ],
  },
  { id: 'UNTITLED', text: '<$Scr_Ps::0>First line\\\nmore', styles: [STYLES.heading] },
  { id: 'SKIPPED', title: 'Skipped', include: false },
];

const compile = (options: Partial<FixtureOptions> = {}, author = 'Ada') =>
  compileProject(openProject(writeFixture({ items: ITEMS, ...options })), { author });

/** The fixture format's two layouts: Heading, for folders, and Text Section. */
function layouts(format: Scrformat) {
  const [heading, textSection] = format.sectionLayouts;
  return { heading: heading!, textSection: textSection! };
}

/** The compile set to this scope. */
const scope = (chosen: string) => (settings: CompileXml) =>
  void (settings.projectSettings.content.scope = chosen);

/** The fixture format's MultiMarkdown settings. */
const mmd = (format: Scrformat) => format.mmd!;

/** The project's layout for each section type, for the fixture format. */
const assigned = (settings: CompileXml) => settings.formats[0]!.sectionLayouts;

/** Headings with titles, hashes closing them or not. */
const titled = (closingHashes: boolean) => (format: Scrformat) => {
  const { heading, textSection } = layouts(format);
  heading.include = { titles: true };
  heading.titles = {};
  textSection.include = { titles: true, text: true };
  mmd(format).addClosingHashesToTitles = closingHashes;
};

describe('compileProject', () => {
  it('compiles the Draft folder with section layouts, separators, placeholders and metadata', () => {
    expect(compile()).toBe(
      '---\ntitle: Fixture  \nauthor: Ada\n---\n\n' +
        '[Part]' +
        '\n\n::: {file="intro.md"}\n\nHello "world" --- fine... -- it\'s\n\n:::' +
        '\n\n::: {file=""}\n\n# First line\nmore\n\n:::',
    );
  });

  it('writes MultiMarkdown metadata without Pandoc syntax, and leaves out empty values', () => {
    const output = compile({ format: (format) => void (mmd(format).usePandocSyntax = false) }, '');
    expect(output.startsWith('Title: Fixture  \nAuthor:\n\n[Part]')).toBe(true);
  });

  it('adds a first document called Metadata to the metadata block, verbatim', () => {
    const items: ItemSpec[] = [
      { id: 'M', title: 'Meta-data', text: 'Subject:\\tab <$projecttitle>  \\\nKeywords: k\\\n' },
      ...ITEMS,
    ];
    const output = compile({
      items,
      format: (format) => {
        mmd(format).usePandocSyntax = false;
        mmd(format).metadata.push({ key: 'Last', value: 'l' });
      },
    });
    expect(output).toMatch(
      /^Title: Fixture {2}\nAuthor: Ada {2}\nSubject:\tFixture {2}\nKeywords: k\nLast: l\n\n\[Part\]/,
    );
    expect(() =>
      compile({
        items,
        format: (format) => void (mmd(format).metadata = [{ key: 'Only', value: 'o' }]),
      }),
    ).toThrow('Unsupported: a metadata document with a format that leaves out project metadata');
  });

  it('writes no metadata block when there is no metadata', () => {
    const output = compile({
      format: (format) => void (mmd(format).metadata = []),
    });
    expect(output.startsWith('[Part]')).toBe(true);
  });

  it('places format metadata around the project metadata, and keeps smart punctuation when asked', () => {
    const output = compile({
      format: (format) => {
        mmd(format).metadata.unshift({ key: 'Base', value: '1' });
        format.transformations!.removeSmartPunctuation = false;
      },
    });
    expect(output).toContain('---\nbase: 1  \ntitle: Fixture  \n');
    expect(output).toContain('Hello “world” — fine… – it’s');
  });

  it("uses a layout's own separators, and prints items with no layout as they are", () => {
    const output = compile({
      format: (format) => {
        layouts(format).textSection.separators = { useDefault: false, ...separators('Single') };
      },
      compile: (settings) => void (assigned(settings)[0]!.layoutId = 'AS-IS'),
    });
    expect(output).toContain('---\n\n\n\n::: {file="intro.md"}');
    expect(output).toContain(':::\n\n::: {file=""}');
  });

  it('separates a folder after a section with the folder defaults', () => {
    const output = compileProject(
      openProject(
        writeFixture({
          items: [
            { id: 'A', title: 'A', text: 'a' },
            { id: 'B', type: 'Folder', title: 'B' },
          ],
        }),
      ),
    );
    expect(output.endsWith(':::\n\n[B]')).toBe(true);
  });

  it('gives subdocuments the section type their ancestor chose for them, unless set by hand', () => {
    const output = compile({
      items: [
        {
          id: 'P',
          type: 'Folder',
          title: 'P',
          childSection: 'T-HEADING',
          children: [
            { id: 'C', title: 'C', text: 'c', children: [{ id: 'G', title: 'G', text: 'g' }] },
            { id: 'O', title: 'O', text: 'o', section: 'T-SECTION' },
          ],
        },
      ],
    });
    expect(output).toContain('[C]\nc');
    expect(output).toContain('[G]\ng');
    expect(output).toContain('::: {file=""}\n\no\n\n:::');
  });

  it('uses the section type chosen by hand, and the deepest level for deeper items', () => {
    const output = compile({
      items: [
        { id: 'A', title: 'A', section: 'T-HEADING', text: 'a' },
        {
          id: 'B',
          type: 'Folder',
          title: 'B',
          children: [{ id: 'C', type: 'Folder', title: 'C' }],
        },
      ],
    });
    expect(output).toContain('---\n\n[A]\na\n\n[B]\n\n[C]');
  });

  it('prints items whose section type has no default as they are', () => {
    const output = compile({
      items: [
        { id: 'A', type: 'Folder', title: 'A' },
        { id: 'B', type: 'Folder', title: 'B' },
        { id: 'C', title: 'C', text: 'c' },
      ],
      scrivx: (scrivx) => void (scrivx.sectionTypes.levels.folders = []),
    });
    expect(output).toBe(
      '---\ntitle: Fixture  \nauthor: Ada\n---\n\n\n\n\n\n::: {file=""}\n\nc\n\n:::',
    );
  });

  it('compiles included items when no scope is set, and gives text with children its own type', () => {
    const output = compile({
      items: [{ id: 'A', title: 'A', text: 'a', children: [{ id: 'B', title: 'B', text: 'b' }] }],
      compile: (settings) => void delete settings.projectSettings.content.scope,
      scrivx: (scrivx) => void (scrivx.sectionTypes.levels.containers = ['T-HEADING']),
    });
    expect(output).toContain('---\n\n[A]\na\n\n::: {file=""}\n\nb\n\n:::');
  });

  it('honours the Excluded and All scopes', () => {
    const excluded = compile({ compile: scope('Excluded') });
    expect(excluded).toContain('---\n\n::: {file=""}\n\n\n\n:::');
    const all = compile({ compile: scope('All') });
    expect(all.match(/::: \{/g)).toHaveLength(3);
  });

  it('keeps only what a filter matches, by label, status, collection or value', () => {
    const items: ItemSpec[] = [
      { id: 'A', title: 'A', text: 'first text', label: '1', status: '2' },
      { id: 'B', title: 'B', text: 'second text' },
    ];
    const only = (filter: ContentFilter) => compile({ items, compile: filtered(filter) });
    const label = only({ state: 'On', exclude: false, type: 'Label', label: '1' });
    expect(label).toContain('first text');
    expect(label).not.toContain('second text');
    const status = only({ state: 'On', exclude: false, type: 'Status', status: '2' });
    expect(status).not.toContain('second text');
    const outOfIt = only({ state: 'On', exclude: true, type: 'Label', label: '1' });
    expect(outOfIt).not.toContain('first text');
    expect(outOfIt).toContain('second text');
  });

  it('filters by the items a collection lists, and finds none in one it does not have', () => {
    const items: ItemSpec[] = [
      { id: 'A', title: 'A', text: 'first text' },
      { id: 'B', title: 'B', text: 'second text' },
    ];
    const held = {
      type: 'Arbitrary',
      id: 'C1',
      color: [0, 0, 0],
      title: 'Picked',
      binderIds: ['A'],
    };
    const options = (collectionId: string) => ({
      items,
      scrivx: (scrivx: Scrivx) => void scrivx.collections.push(held),
      compile: filtered({ state: 'On', exclude: false, type: 'Collection', collectionId }),
    });
    expect(compile(options('C1'))).not.toContain('second text');
    expect(compile(options('C1'))).toContain('first text');
    expect(compile(options('NONE'))).not.toContain('first text');
  });

  it('compiles the included items of items it leaves out, by include or by filter', () => {
    const items: ItemSpec[] = [
      {
        id: 'F',
        type: 'Folder',
        title: 'F',
        include: false,
        children: [{ id: 'X', text: 'kept x' }],
      },
      {
        id: 'G',
        text: 'gone g',
        status: '2',
        custom: { platform: '0' },
        children: [{ id: 'Y', text: 'kept y', custom: { platform: '1' } }],
      },
    ];
    for (const filter of [
      { state: 'On', exclude: true, type: 'Custom', metadataFilterId: 'platform', metadataId: '0' },
      { state: 'On', exclude: true, type: 'Status', status: '2' },
    ]) {
      const output = compile({
        items,
        compile: (settings) => void (settings.projectSettings.content.filter = filter),
      });
      expect(output).toContain('kept x');
      expect(output).toContain('kept y');
      expect(output).not.toContain('gone g');
    }
  });

  it("adds a file type's own front matter in place of the default", () => {
    const output = compile({
      topLevel: [
        { id: 'FM', type: 'Folder', title: 'FM', children: [{ id: 'T', text: 'front text' }] },
        {
          id: 'OTHER',
          type: 'Folder',
          title: 'Other',
          children: [{ id: 'O', text: 'other text' }],
        },
      ],
      compile: (settings) => {
        settings.formats[0]!.frontAndBackMatter = {
          defaultFront: { add: true, folderId: 'OTHER' },
          perFileType: { mmd: { front: { add: true, lock: true, folderId: 'FM' } } },
        };
      },
    });
    expect(output).toContain('front text');
    expect(output).not.toContain('other text');
  });

  it('evaluates title, custom, project and author placeholders, and honours escapes', () => {
    const project = openProject(
      writeFixture({
        items: [
          {
            id: 'P',
            title: 'Page',
            text:
              '<$title> <$custom:TargetFile> <$custom:Missing> <$projectname> <$abbr_projecttitle> ' +
              '<$fullname> <$name> \\\\<$date>',
            custom: { targetfile: 't.md' },
          },
        ],
        compile: ({ projectSettings: { metadata } }) => {
          metadata.projectTitle = '';
          metadata.abbreviatedTitle = '';
          metadata.authors = [{ name: 'Ann' }, { name: 'Bo' }];
        },
      }),
    );
    expect(readText(readModel(project), findItem(indexBinder(project.binder), 'P'))).toBe(
      'Page t.md  Fixture Fixture Ann Ann <$date>',
    );
  });
});

/** The Text Section layout, including these parts. */
const includeLayout = (include: LayoutInclude) => (format: Scrformat) =>
  void (layouts(format).textSection.include = include);

const subtitledMetadata = (format: Scrformat) => {
  includeLayout({ titles: true, metadata: true, text: true, synopses: true })(format);
  format.formattingOptions!.includeSubtitles = true;
};

const emptyPrefixAfterTitle = (format: Scrformat) => {
  const { textSection } = layouts(format);
  textSection.include = { titles: true };
  textSection.prefix = { afterTitle: true, document: readDocumentText('') };
};

const printed = (custom: Record<string, string>) =>
  compileProject(
    openProject(
      writeFixture({ items: [{ id: 'D', title: 'D', text: '<$custom:Place>', custom }] }),
    ),
  );

describe('a list field in a placeholder', () => {
  it('prints its option, or the name for none', () => {
    expect(printed({ place: '1' })).toContain('Renderer');
    expect(printed({})).toContain('Unassigned');
  });
});

describe('layout parts', () => {
  it('stops on metadata with subtitles, and on metadata in a project with custom fields', () => {
    expect(() => compile({ format: subtitledMetadata })).toThrow(
      'Unsupported: metadata with subtitles',
    );
    expect(() => compile({ format: includeLayout({ metadata: true, text: true }) })).toThrow(
      'Unsupported: metadata in a project with custom metadata fields',
    );
  });

  it('writes a title with nothing after it when the prefix after the title is empty', () => {
    expect(
      compile({ format: emptyPrefixAfterTitle, items: [{ id: 'A', title: 'A', text: 'a' }] }),
    ).toContain('---\n\n# A\n\n:::');
  });
});

describe('read', () => {
  it('ends a document with its footnotes, its links to documents left out as plain text', () => {
    const project = openProject(
      writeFixture({
        items: [
          {
            id: 'A',
            title: 'A',
            text: 'Note\\{\\\\Scrv_fn= the note \\\\end_Scrv_fn\\} and {\\field{\\*\\fldinst HYPERLINK "scrivlnk://B"}{\\fldrslt link}}',
          },
          { id: 'B', title: 'Target' },
        ],
        compile: ({ projectSettings: { options } }) => {
          delete options.removeFootnotes;
          options.convertLinksToMmd = true;
        },
      }),
    );
    expect(readText(readModel(project), findItem(indexBinder(project.binder), 'A'))).toBe(
      'Note[^cf1] and link\n\n[^cf1]: the note',
    );
  });
});

describe('titles', () => {
  it('heads titled items with one # per level, and leaves out untitled titles and folder text', () => {
    const output = compile({
      items: [
        {
          id: 'P',
          type: 'Folder',
          title: 'Part',
          text: 'Folder text is left out',
          children: [
            { id: 'C', title: 'Chapter', text: 'Body' },
            { id: 'U', text: 'Untitled body' },
            { id: 'E', title: 'Empty' },
          ],
        },
      ],
      format: titled(true),
    });
    expect(output).toContain(
      '[Part]\n# Part #\n\n::: {file=""}\n\n## Chapter ##\n\nBody\n\n:::' +
        '\n\n::: {file=""}\n\nUntitled body\n\n:::\n\n::: {file=""}\n\n## Empty ##\n\n:::',
    );
  });

  it('leaves titles open when the format adds no closing hashes', () => {
    const output = compile({
      items: [{ id: 'C', title: 'Chapter', text: 'Body' }],
      format: titled(false),
    });
    expect(output).toContain('# Chapter\n\nBody');
  });

  const fixtures = path.join(import.meta.dirname, '..', 'test', 'fixtures');
  // `X.md` is Scrivener's compile of `X.scriv` with its last-used format; `X.<Format>.md` is its
  // compile with that format.
  const goldens = fs
    .readdirSync(fixtures)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const [project = '', format] = name.slice(0, -'.md'.length).split('.');
      return { name, project: `${project}.scriv`, format };
    });
  it.each(goldens)("matches Scrivener's own compile in $name", ({ name, project, format }) => {
    const opened = openProject(path.join(fixtures, project));
    const expected = fs.readFileSync(path.join(fixtures, name), 'utf8');
    // The fixtures were compiled on 2026-10-31, which today's-date placeholders print.
    const now = new Date(2026, 9, 31, 12);
    expect(compileProject(opened, format ? { format, now } : { now })).toBe(expected);
  });
});

/** A copy of a fixture project with one of its formats changed. */
function changedFixture(
  name: string,
  formatFile: string,
  change: (format: Scrformat) => void,
): string {
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scrivener-changed-')), name);
  fs.cpSync(path.join(import.meta.dirname, '..', 'test', 'fixtures', name), copy, {
    recursive: true,
  });
  const file = path.join(copy, 'Settings', 'Compile Formats', formatFile);
  const { model } = readFormatFile(file, 'project');
  change(model);
  fs.writeFileSync(file, writeScrformat(model));
  return copy;
}

describe('fixture projects changed where no fixture has gone', () => {
  it('stop on a suffix run on into a list before a page break', () => {
    const project = changedFixture('followups.scriv', 'Fixture-Follow-ups.scrformat', (format) => {
      const { textSeparators } = format.separatorSettings;
      textSeparators.before.type = 'PageBreak';
      textSeparators.between.type = 'PageBreak';
    });
    expect(() => compileProject(openProject(project))).toThrow(
      'Unsupported: a suffix run on into a list before a separator other than a return',
    );
  });

  it('stop on a link to a heading whose text is all placeholders that come to nothing', () => {
    const project = changedFixture(
      'title-links.scriv',
      'Fixture-Title-Links-Off.scrformat',
      (format) => {
        // The layout that writes a title prefix and suffix but no title.
        const untitled = format.sectionLayouts.find((layout) => layout.name === 'Untitled')!;
        untitled.titles!.prefix!.text = '<$custom:Nothing>';
      },
    );
    expect(() =>
      compileProject(openProject(project), { format: 'Fixture Title Links Off' }),
    ).toThrow('Unsupported: a document link to a heading with no text');
  });
});

describe('the outstanding fixture, split by feature', () => {
  const fixtures = path.join(import.meta.dirname, '..', 'test', 'fixtures');
  const whole = fs.readFileSync(path.join(fixtures, 'outstanding.md'), 'utf8');
  const [header = ''] = whole.split('\n\n');
  const footnotes = whole.slice(whole.indexOf('\n\n[^cf1]:'));

  /** A copy of the outstanding project that compiles only the named top-level folder. */
  const only = (folder: string) => {
    const copy = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'scrivener-split-')),
      'outstanding.scriv',
    );
    fs.cpSync(path.join(fixtures, 'outstanding.scriv'), copy, { recursive: true });
    const project = openProject(copy);
    const group = flatten(project.binder).find((item) => item.title === folder)!;
    const keep = new Set([...flatten([group]), draftFolder(project)]);
    for (const item of flatten(project.binder)) {
      if (item.metadata) item.metadata.includeInCompile = keep.has(item);
    }
    saveProject(project);
    return openProject(copy);
  };

  /** The folder's sections in the whole compile: from its heading to the next top-level one. */
  const fragment = (folder: string) => {
    const start = whole.indexOf(`# ${folder} #\n`);
    const next = whole.slice(start + 1).search(/\n\n# [^\n]+ #\n|\n\n\[\^cf1\]:/);
    return whole.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  it.each([
    'Text',
    'Tables',
    'Layouts',
    'Numbering ahn',
    'Numbering aon',
    'Numbering hn_0',
    'Numbering hn_level1',
  ])('compiles %s alone to its fragment of the whole compile', (folder) => {
    // Alone, the Text folder's link names a section the compile leaves out, so it is plain text.
    const alone = fragment(folder).replace('[the stats][Stats]', 'the stats');
    const expected = `${header}\n\n${alone}${folder === 'Text' ? footnotes : ''}`;
    expect(compileProject(only(folder), { now: new Date(2026, 9, 31, 12) })).toBe(expected);
  });
});

const named = (id: string, value: string | undefined, text: string): ItemSpec => ({
  id,
  title: id,
  text,
  ...(value === undefined ? {} : { custom: { targetfile: value } }),
});
const modelOf = (items: ItemSpec[]) => readModel(openProject(writeFixture({ items })));

const noted = (word: string) => `${word}${footnote(`${word} note`)}`;

/** A project whose links convert, with headings to name. */
const linked = (items: ItemSpec[], format = titled(false)) =>
  readModel(openProject(writeFixture({ items, compile: LINKS, format })));

/** What file A, at `from`, writes for its link to B. */
const linkFrom = (from: string, target: ItemSpec, options?: CompileFilesOptions) => {
  const model = linked([named('A', from, `see ${linkTo('B', 'to b')}`), target]);
  return compileFiles(model, 'targetfile', options).files[0]!.text;
};

/** Text sections with nothing of the layout's around them. */
const bare = (format: Scrformat) => {
  const { textSection } = layouts(format);
  delete textSection.prefix;
  delete textSection.suffix;
};

describe('a compile to many files', () => {
  const PICTURE = String.raw`{\*\shppict{\pict {\*\nisusfilename shot_1}\picw1\pich1\jpegblip ffd8}}`;
  it('writes a file for each value, and says which items have none', () => {
    const model = modelOf([
      named('A', 'a.md', 'one'),
      named('B', 'docs/b.md', 'two'),
      named('C', undefined, 'three'),
    ]);
    const { files, unnamed } = compileFiles(model, 'targetfile');
    expect(files.map(({ name }) => name)).toEqual(['a.md', 'docs/b.md']);
    expect(files[0]!.text).toContain('one');
    expect(files[0]!.text).not.toContain('two');
    expect(unnamed.map(({ id }) => id)).toEqual(['C']);
  });

  it('counts an empty value as none, and an item the compile leaves out as nothing', () => {
    const left = { ...named('B', 'b.md', 'two'), include: false };
    const { files, unnamed } = compileFiles(modelOf([named('A', '', 'one'), left]), 'targetfile');
    expect(files).toEqual([]);
    expect(unnamed.map(({ id }) => id)).toEqual(['A']);
  });

  it('joins items that share a value, as one compile of those items does', () => {
    const items = [named('A', 'same.md', 'one'), named('B', 'same.md', 'two')];
    const model = modelOf(items);
    const [file] = compileFiles(model, 'targetfile').files;
    expect(file!.items.map(({ id }) => id)).toEqual(['A', 'B']);
    const prepared = prepareCompile(model);
    expect(file!.text).toBe(writeSections(prepared, prepared.sections).text);
  });

  it('gives a file only the images it refers to, with their bytes', () => {
    const model = modelOf([named('A', 'a.md', `one ${PICTURE}`), named('B', 'b.md', 'two')]);
    const [a, b] = compileFiles(model, 'targetfile').files;
    expect(a!.images.map(({ file }) => file)).toEqual(['shot_1.jpg']);
    expect(a!.images[0]!.bytes).toEqual(Uint8Array.of(0xff, 0xd8));
    expect(a!.text).toContain('[shot_1]: shot_1.jpg');
    expect(b!.images).toEqual([]);
    expect(b!.text).not.toContain('shot_1');
  });

  it.each([
    ['a.md', 'b.md', 'b.md'],
    ['guides/setup.md', 'guides/api.md', 'api.md'],
    ['guides/setup.md', 'reference/api.md', '../reference/api.md'],
    ['a.md', 'reference/deep/api.md', 'reference/deep/api.md'],
    ['guides/deep/setup.md', 'guides/api.md', '../api.md'],
    ['a.md', 'my notes (old)/#1.md', 'my%20notes%20%28old%29/%231.md'],
    ['a.md', '@scope/a&b é.md', '@scope/a%26b%20%C3%A9.md'],
  ])('links from %s to a section in %s, from its own folder', (from, to, href) => {
    expect(linkFrom(from, named('B', to, 'two'))).toContain(`see [to b](${href})`);
  });

  it('puts an item in the file `fileOf` gives it, and links to that file', () => {
    const model = linked([
      named('A', 'docs', `see ${linkTo('B', 'to b')}`),
      named('B', 'x', 'two'),
    ]);
    const { files } = compileFiles(model, 'targetfile', {
      fileOf: (value, { title }) => `${value}/${title}.md`,
    });
    expect(files.map(({ name }) => name)).toEqual(['docs/A.md', 'x/B.md']);
    expect(files[0]!.text).toContain('see [to b](../x/B.md)');
  });

  it('links to a file with no heading for the section, whatever its layout writes', () => {
    const untitled = { id: 'B', text: 'two', custom: { targetfile: 'b.md' } };
    expect(linkFrom('a.md', untitled)).toContain('see [to b](b.md)');
  });

  it('keeps a link inside a file as the whole compile writes it', () => {
    const to = linkTo('B', 'to b');
    const model = linked([named('A', 'same.md', `see ${to}`), named('B', 'same.md', 'two')]);
    const [file] = compileFiles(model, 'targetfile').files;
    expect(file!.text).toContain('see [to b][B]');
    const prepared = prepareCompile(model);
    expect(file!.text).toBe(writeSections(prepared, prepared.sections).text);
  });

  it('leaves a link to an item the compile leaves out as plain text', () => {
    const left = { ...named('B', 'b.md', 'two'), include: false };
    expect(linkFrom('a.md', left)).toContain('see to b');
  });

  it('leaves a link to an item with no value as plain text', () => {
    expect(linkFrom('a.md', named('B', undefined, 'two'))).toContain('see to b');
  });

  it('leaves a link to a value whose file is not written as plain text', () => {
    const options = { writes: (name: string) => name === 'a.md' };
    expect(linkFrom('a.md', named('B', 'b.md', 'two'), options)).toContain('see to b');
  });

  it('updates a title in a link across files, as it does inside one', () => {
    const items = [named('A', 'a.md', `see ${linkTo('B', 'B')}`), named('B', 'b.md', 'two')];
    const chapters = updated((format) => {
      titled(false)(format);
      layouts(format).textSection.titles = { prefix: { text: 'Ch ' } };
    });
    const [a] = compileFiles(linked(items, chapters), 'targetfile').files;
    expect(a!.text).toContain('see [Ch B](b.md)');
  });

  it('writes a link as plain text when the compile does not convert links', () => {
    const to = linkTo('B', 'to b');
    const model = modelOf([named('A', 'a.md', `see ${to}`), named('B', 'b.md', 'two')]);
    expect(compileFiles(model, 'targetfile').files[0]!.text).toContain('see to b');
  });

  it('writes a file for an item with no text', () => {
    const items = [{ id: 'A', custom: { targetfile: 'a.md' } }];
    const dir = writeFixture({ items, format: bare });
    const { files, unnamed } = compileFiles(readModel(openProject(dir)), 'targetfile');
    expect(files.map(({ name, text }) => [name, text])).toEqual([['a.md', '']]);
    expect(unnamed).toEqual([]);
  });

  it('keeps a footnote with its section, under the number the whole compile gave it', () => {
    const items = [named('A', 'a.md', noted('one')), named('B', 'b.md', noted('two'))];
    const model = readModel(
      openProject(
        writeFixture({
          items,
          compile: ({ projectSettings }) => {
            delete projectSettings.options.removeFootnotes;
          },
        }),
      ),
    );
    const [a, b] = compileFiles(model, 'targetfile').files;
    expect(a!.text).toContain('[^cf1]: one note');
    expect(a!.text).not.toContain('two note');
    expect(b!.text).toContain('two[^cf2]');
    expect(b!.text).toContain('[^cf2]: two note');
  });

  it('writes every section as the whole compile does, on the outstanding fixture', () => {
    const fixtures = path.join(import.meta.dirname, '..', 'test', 'fixtures');
    const now = new Date(2026, 9, 31, 12);
    const model = readModel(openProject(path.join(fixtures, 'outstanding.scriv')));
    const prepared = prepareCompile(model, { now });
    const whole = writeCompile(prepared);
    const all = writeSections(prepared, prepared.sections).text;
    expect(whole.endsWith(all)).toBe(true);
  });
});

/** A document link whose whole text is `<$include>`. */
const include = (id: string) =>
  `{\\field{\\*\\fldinst{HYPERLINK "scrivlnk://${id}"}}{\\fldrslt <$include>}}`;

describe('footnotes', () => {
  it('go through the replacements and placeholders the text does, for their own item', () => {
    const output = compile({
      items: [
        { id: 'A', title: 'Aye', text: 'a\\{\\\\Scrv_fn=alpha in <$title>\\\\end_Scrv_fn\\}' },
        { id: 'B', title: 'Bee', text: 'b\\{\\\\Scrv_fn=<$title>\\\\end_Scrv_fn\\}' },
      ],
      compile: ({ projectSettings }) => {
        projectSettings.replacements = [{ replace: 'alpha', with: 'beta' }];
        delete projectSettings.options.removeFootnotes;
      },
    });
    expect(output).toContain('[^cf1]: beta in Aye\n\n[^cf2]: Bee');
  });
});

describe('linked images', () => {
  it('writes an image whose file is missing as Scrivener does', () => {
    const output = compile({
      items: [{ id: 'A', title: 'A', text: '\\{$SCRImageLink[w:1;h:1]=no/such/image.png\\}' }],
    });
    expect(output).toContain('MISSING_IMAGE:no/such/image.png');
  });

  it('numbers a list whose level writes a number, though its format says bullet', () => {
    const level = String.raw`{\listlevel\levelnfc23\levelnfcn23\levelstartat1{\*\levelmarker PRE\{x\}}{\leveltext\'04PRE\'00;}{\levelnumbers\'04;}\fi-360\li720\lin720 }`;
    const tables = String.raw`{\*\listtable{\list\listhybrid${level}\listid7}}{\*\listoverridetable{\listoverride\listid7\listoverridecount0\ls7}}`;
    const items = String.raw`\ls7\ilvl0 {\listtext PRE1 }a\par {\listtext PRE2 }b\par\pard after`;
    const out = compile({ items: [{ id: 'A', title: 'A', text: `${tables}${items}` }] });
    expect(out).toContain('1. a\n2. b');
  });

  it('defines a linked image with no size in its link', () => {
    const image = path.join(os.tmpdir(), 'scriv-tools-unsized.png');
    fs.writeFileSync(image, '');
    const out = compile({
      items: [{ id: 'A', title: 'A', text: `\\{$SCRImageLink[]=${image}\\}` }],
    });
    expect(out).toContain('[scriv-tools-unsized]: scriv-tools-unsized.png');
  });

  it('refers to a linked image, and defines it after the text with its size', () => {
    const image = path.join(os.tmpdir(), 'scriv-tools-linked.png');
    fs.writeFileSync(image, '');
    const text = `one \\{$SCRImageLink[w:10;h:20]=${image}\\}`;
    const out = compile({ items: [{ id: 'A', title: 'A', text }] });
    expect(out).toContain('one ![][scriv-tools-linked]');
    expect(out).toContain('[scriv-tools-linked]: scriv-tools-linked.png width=10px height=20px');
  });

  it('refers to an embedded picture, and defines it after the text by its file name', () => {
    const picture = String.raw`{\*\shppict{\pict {\*\nisusfilename shot_1}\picw1\pich1\jpegblip ffd8}}`;
    const out = compile({ items: [{ id: 'A', title: 'A', text: `one ${picture}` }] });
    expect(out).toContain('one ![][shot_1]');
    expect(out).toContain('[shot_1]: shot_1.jpg');
  });

  it('stops on an embedded picture with no file name', () => {
    const picture = String.raw`{\*\shppict{\pict\picw1\pich1\jpegblip ffd8}}`;
    expect(() => compile({ items: [{ id: 'A', title: 'A', text: picture }] })).toThrow(
      'an embedded picture with no file name',
    );
  });

  it('takes the project default choices for a format with none of its own', () => {
    const out = compile({
      items: [{ id: 'A', title: 'A', text: 'one' }],
      compile: (settings) => {
        for (const choices of settings.formats) choices.id = 'DEFAULT';
      },
    });
    expect(out).toContain('one');
  });
});

/** The fixture's Heading layout, with formatting overridden by these part samples. */
const overridden =
  (parts: Partial<LayoutFormatting>, titles: LayoutTitles = {}) =>
  (format: Scrformat) => {
    const { heading } = layouts(format);
    heading.include = { titles: true, text: true };
    heading.titles = { mmdHashCount: 0, ...titles };
    heading.formatting = { override: true, ...parts };
    delete heading.blankLineSeparator;
  };

/** A formatting sample in the format styles listed, which its markers number. */
const sample = (ids: string, body: string): FormattingSample => ({
  styleIds: ids.split(','),
  document: readDocumentText(rtfDocument(body)),
});

const SHOUT = { name: 'Shout', id: 'F-SHOUT', type: 'Char', prefix: '**', suffix: '**' };

/** The fixture format with a Shout style, then changed by `change`. */
const withShout = (change: (format: Scrformat) => void) => (format: Scrformat) => {
  format.styles!.push(SHOUT);
  change(format);
};

describe('overridden layout formatting', () => {
  const items = [
    {
      id: 'A',
      title: 'A',
      section: 'T-HEADING',
      text: 'one\\\n<$Scr_Ps::0>own<!$Scr_Ps::0>\\\ntwo',
      styles: [STYLES.heading],
    },
  ];

  it("styles the text with the text sample's paragraph style, until the document's own", () => {
    const output = compile({
      items,
      format: overridden({
        title: { document: readDocumentText('plain') },
        text: sample('F-MARKED', '<$Scr_Ps::0>Attributes<!$Scr_Ps::0>'),
      }),
    });
    expect(output).toContain('A\n| one\n# own\n| two');
  });

  it("styles the title suffix with its sample's character style, after its leading spaces", () => {
    const output = compile({
      items,
      format: withShout(
        overridden(
          { titleSuffix: sample('F-SHOUT', '<$Scr_Cs::0>Attributes<!$Scr_Cs::0>') },
          { suffix: { text: ' loud' } },
        ),
      ),
    });
    expect(output).toContain('A **loud**\none');
  });

  it.each([
    [{ text: sample('F-SHOUT', '<$Scr_Cs::0>x<!$Scr_Cs::0>') }, 'Text formatting in Shout'],
    [{ title: sample('F-SHOUT', '<$Scr_Cs::0>x<!$Scr_Cs::0>') }, 'Title formatting in Shout'],
    [{ text: sample('F-HEADING', '<$Scr_Ps::0>x<!$Scr_Ps::0>') }, 'styling text in "Heading 1"'],
    [{ text: sample('', '<$Scr_Cs::4>x<!$Scr_Cs::4>') }, 'Text formatting in '],
    [
      { text: sample('F-MARKED,F-SHOUT', '<$Scr_Ps::0><$Scr_Cs::1>x<!$Scr_Cs::1><!$Scr_Ps::0>') },
      'Text formatting in Marked, Shout',
    ],
  ])('stops on styled samples not worked out yet: %#', (part, feature) => {
    expect(() => compile({ items, format: withShout(overridden(part)) })).toThrow(feature);
  });

  it('writes text and suffixes plainly in a style the format does not have', () => {
    const output = compile({
      items,
      format: overridden(
        {
          text: sample('F-NOPE', '<$Scr_Ps::0>x<!$Scr_Ps::0>'),
          titleSuffix: sample('F-NOPE', '<$Scr_Cs::0>x<!$Scr_Cs::0>'),
        },
        { suffix: { text: ' loud' } },
      ),
    });
    expect(output).toContain('A loud\none\n# own\ntwo');
  });

  it('stops on a style in a layout prefix', () => {
    expect(() =>
      compile({
        items,
        format: (format) => {
          const prefix = field('<$Scr_Cs::0>[<$title>]<!$Scr_Cs::0>\\\n');
          layouts(format).heading.prefix = { document: prefix };
        },
      }),
    ).toThrow('Unsupported: a section layout prefix or suffix with a style');
  });

  it('ignores formatting that is not overridden', () => {
    const output = compile({
      items,
      format: (format) => {
        overridden({ text: sample('F-MARKED', '<$Scr_Ps::0>x<!$Scr_Ps::0>') })(format);
        layouts(format).heading.formatting!.override = false;
      },
    });
    expect(output).toContain('A\none\n# own\ntwo');
  });
});

describe('placeholders as link text', () => {
  it('describe the linked document, after replacements, and write no link', () => {
    const output = compile({
      items: [
        {
          id: 'A',
          title: 'A',
          text: 'see {\\field{\\*\\fldinst{HYPERLINK "scrivlnk://B"}}{\\fldrslt <$ttl>}} now',
        },
        { id: 'B', title: 'Bee', text: 'b', include: false },
      ],
      compile: ({ projectSettings }) => {
        projectSettings.replacements = [{ replace: '<$ttl>', with: '<$title>' }];
      },
    });
    expect(output).toContain('see Bee now');
  });
});

/** Headings with a title prefix. */
const prefixed = (format: Scrformat) => {
  titled(false)(format);
  layouts(format).heading.titles = { prefix: { text: 'Ch ' } };
};

/** A link to item `id` that reads `text`. */
const linkTo = (id: string, text: string) =>
  `{\\field{\\*\\fldinst{HYPERLINK "scrivlnk://${id}"}}{\\fldrslt ${text}}}`;

/** Links converted to MultiMarkdown. */
const LINKS = (settings: CompileXml) =>
  void (settings.projectSettings.options.convertLinksToMmd = true);

/** Title links updated with the title prefix and suffix. */
const updated = (change: (format: Scrformat) => void) => (format: Scrformat) => {
  change(format);
  format.titleLinks = { updateLinksWithPrefixAndSuffix: { update: true } };
};

/** Titles run into the text. */
const runIn = (format: Scrformat) => {
  titled(false)(format);
  layouts(format).heading.titles = { runInHead: true };
};

/** Run-in titles with a title prefix. */
const prefixedRunIn = (format: Scrformat) => {
  runIn(format);
  layouts(format).heading.titles!.prefix = { text: 'Ch ' };
};

describe('document links', () => {
  const items: ItemSpec[] = [
    { id: 'B', type: 'Folder', title: 'Target' },
    { id: 'A', title: 'A', text: `see ${linkTo('B', 'it')} and ${linkTo('B', 'Target')}` },
  ];

  it('name the heading they link to, prefix and all, and update a link that reads the title', () => {
    expect(compile({ items, compile: LINKS, format: prefixed })).toContain(
      'see [it][Ch Target] and [Target][Ch Target]',
    );
    expect(compile({ items, compile: LINKS, format: updated(prefixed) })).toContain(
      'see [it][Ch Target] and [Ch Target][]',
    );
  });

  it('stop on a run-in title, which is not a heading', () => {
    expect(() => compile({ items, compile: LINKS, format: runIn })).toThrow(
      'Unsupported: a document link to a',
    );
    expect(() => compile({ items, compile: LINKS, format: prefixedRunIn })).toThrow(
      'Unsupported: a document link to a',
    );
  });

  it('stop in the metadata, which comes before the headings', () => {
    const metadata: ItemSpec[] = [
      { id: 'M', title: 'Meta-data', text: `Subject: ${linkTo('B', 'it')}\\\n` },
      ...items,
    ];
    expect(() => compile({ items: metadata, compile: LINKS })).toThrow(
      'Unsupported: a document link in the metadata',
    );
  });
});

describe('includes', () => {
  it("puts a linked document's compiled text where a link reads <$include>", () => {
    const output = compile({
      items: [
        { id: 'A', title: 'A', text: `before ${include('B')} after` },
        { id: 'B', title: 'B', text: 'included <$Scr_Cs::0>text<!$Scr_Cs::0>', include: false },
      ],
    });
    expect(output).toContain('before included text after');
  });

  it('stops on a document that includes itself', () => {
    expect(() => compile({ items: [{ id: 'A', title: 'A', text: include('A') }] })).toThrow(
      'Unsupported: a document that includes itself in "A" (A)',
    );
  });
});

describe('compile errors', () => {
  it('name the item for other errors too, unchanged otherwise', () => {
    const project = writeFixture({ items: [{ id: 'A', title: 'A', text: 'x' }] });
    const rtfPath = path.join(project, 'Files', 'Data', 'A', 'content.rtf');
    fs.rmSync(rtfPath);
    fs.mkdirSync(rtfPath);
    expect(() => compileProject(openProject(project))).toThrow('EISDIR');
  });

  it('compile a document with no paragraphs, as text and as the metadata document, to nothing', () => {
    const project = openProject(
      writeFixture({
        items: [
          { id: 'M', title: 'Meta-data', text: '' },
          { id: 'A', title: 'A', text: '' },
        ],
      }),
    );
    expect(readText(readModel(project), findItem(indexBinder(project.binder), 'A'))).toBe('');
    expect(compileProject(project)).not.toContain('Meta-data');
  });

  it('leave <$custom> with no field name empty', () => {
    const project = openProject(
      writeFixture({ items: [{ id: 'A', title: 'A', text: '[<$custom>]' }] }),
    );
    expect(readText(readModel(project), findItem(indexBinder(project.binder), 'A'))).toBe('[]');
  });
});

/** A compile contents filter. */
const filtered = (filter: ContentFilter) => (settings: CompileXml) =>
  void (settings.projectSettings.content.filter = filter);

/** The compile set to include the Draft folder's own text. */
const withGroupText = (settings: CompileXml) =>
  void (settings.projectSettings.content.includeGroupText = true);

describe('compile stops', () => {
  it.each([
    [
      'a compile contents filter',
      { compile: filtered({ state: 'On', exclude: false, type: 'Label' }) },
      'compile contents filter',
    ],
    [
      'a regular expression JavaScript cannot read',
      {
        compile: ({ projectSettings }) =>
          void (projectSettings.replacements = [{ regex: true, replace: '(', with: '' }]),
      },
      'regular expression (',
    ],
    [
      'a filter with no value to leave out',
      { compile: filtered({ state: 'On', exclude: true, type: 'Status' }) },
      'compile contents filter on Status',
    ],
    [
      'a filter on a custom field it does not name',
      { compile: filtered({ state: 'On', exclude: true, type: 'Custom', metadataId: '0' }) },
      'compile contents filter on Custom',
    ],
    [
      'a filter on a collection',
      { compile: filtered({ state: 'On', exclude: true, type: 'Collection' }) },
      'compile contents filter on Collection',
    ],
    [
      'a built-in layout',
      { compile: (settings) => void (assigned(settings)[1]!.layoutId = 'TEXT-SECTION') },
      'built-in section layout TEXT-SECTION',
    ],
    [
      'the Draft folder’s own text',
      { compile: withGroupText, draftText: 'x' },
      'compiling the text of the Draft folder itself',
    ],
    [
      'media in the Draft folder',
      { items: [{ id: 'M', type: 'Other', title: 'Pic' }] },
      'media items in the Draft folder in "Pic" (M)',
    ],
    [
      'a PDF in the Draft folder',
      { items: [{ id: 'P', type: 'PDF', title: 'Spec' }] },
      'media items in the Draft folder in "Spec" (P)',
    ],
    [
      'a placeholder the CLI does not evaluate',
      { items: [{ id: 'D', title: 'D', text: '<$toc>' }] },
      'placeholder <$toc> in "D" (D)',
    ],
    [
      'a custom placeholder for a field that is not text',
      { items: [{ id: 'D', title: 'D', text: '<$custom:Ready>' }] },
      '<$custom> for a Checkbox field',
    ],
  ] satisfies [string, Partial<FixtureOptions>, string][])('on %s', (_name, options, feature) => {
    const project = writeFixture({ items: ITEMS, ...options });
    expect(() => compileProject(openProject(project))).toThrow(`Unsupported: ${feature}`);
  });

  it.each([
    ['<Filter', '<Group/><Filter', 'a Group element in Content'],
    ['<PDF>', '<Mystery/><PDF>', 'a Mystery element in Options'],
    [
      '</SectionLayouts>\n        </Format>',
      '</SectionLayouts><FrontAndBackMatter><DefaultFrontMatter/><DefaultBackMatter Add="Yes"/></FrontAndBackMatter></Format>',
      'a DefaultBackMatter element in FrontAndBackMatter',
    ],
  ])('on compile settings it does not know: %s', (from, to, feature) => {
    const project = writeFixture({ items: ITEMS });
    const file = path.join(project, 'Settings', 'compile.xml');
    const xml = fs.readFileSync(file, 'utf8');
    expect(xml).toContain(from);
    fs.writeFileSync(file, xml.replace(from, to));
    expect(() => compileProject(openProject(project))).toThrow(
      `Unsupported: compile settings holding ${feature}`,
    );
  });

  it('only when the Draft folder that includes its own text has some', () => {
    const project = writeFixture({ items: [], compile: withGroupText });
    expect(compileProject(openProject(project))).toBe('---\ntitle: Fixture  \nauthor:\n---\n\n');
  });

  it('when the project was never compiled, has no Draft folder, or no layouts for the format', () => {
    expect(() => compile({ neverCompiled: true })).toThrow('has never been compiled');
    expect(() => compile({ compile: (settings) => void (settings.lastUsedFormats = {}) })).toThrow(
      'the last used format (none)',
    );
    expect(() => compile({ scrivx: (scrivx) => void (scrivx.binder[0]!.type = 'Folder') })).toThrow(
      'The project has no Draft folder.',
    );
    expect(() =>
      compile({ compile: (settings) => void (settings.formats[0]!.id = 'OTHER') }),
    ).toThrow('no section layouts assigned for format "Fixture Format"');
  });
});

/** Text typed with bold, italic, both, and Markdown's punctuation. */
const TYPED =
  'Plain \\b bold\\b0 , \\i italic\\i0  and \\b\\i both\\b0\\i0 : *star* [x] a_b `c` \\\\';
/** The text of one document's compile, with the option as given. */
const converted = (
  text: string,
  rich?: { convert: boolean; doNotEscape?: boolean },
  styles?: string[],
) => {
  const output = compile({
    items: [{ id: 'A', title: 'A', text, ...(styles ? { styles } : {}) }],
    compile: ({ projectSettings: { options } }) => {
      if (rich) options.convertRichTextToMmd = rich;
    },
  });
  return output.slice(output.indexOf('}\n\n') + 3, output.lastIndexOf('\n\n:::'));
};

describe('converting rich text to MultiMarkdown', () => {
  const on = { convert: true };

  it('leaves bold and italic as plain text when it is off', () => {
    expect(converted(TYPED)).toBe('Plain bold, italic and both: *star* [x] a_b `c` \\');
    expect(converted(TYPED, { convert: false })).toBe(converted(TYPED));
  });

  it('writes bold and italic between markers, and escapes Markdown punctuation', () => {
    expect(converted(TYPED, on)).toBe(
      'Plain **bold**, *italic* and ***both***: \\*star\\* \\[x\\] a\\_b \\`c\\` \\\\',
    );
  });

  it('leaves punctuation as typed without Escape special characters', () => {
    expect(converted(TYPED, { convert: true, doNotEscape: true })).toBe(
      'Plain **bold**, *italic* and ***both***: *star* [x] a_b `c` \\',
    );
  });

  it('runs bold on across a change of formatting, with whitespace outside its markers', () => {
    expect(converted('\\b one \\fs30 two\\fs24\\b0', on)).toBe('**one two**');
    expect(converted('\\b one\\fs30  \\fs24 two \\fs30  \\fs24\\b0 x', on)).toBe('**one two**  x');
    expect(converted('\\b  \\b0 x \\b y\\b0  \\i z\\i0', on)).toBe(' x **y** *z*');
  });

  it('keeps a code span, and a raw markup style, as typed', () => {
    const span = '<$Scr_Cs::0>\\b a*b\\b0<!$Scr_Cs::0> \\b c*d\\b0';
    expect(converted(span, on, [STYLES.codeSpan])).toBe('`a*b` **c\\*d**');
    const block = '<$Scr_Ps::0>\\b a*b\\b0<!$Scr_Ps::0>';
    expect(converted(block, on, [STYLES.codeBlock])).toBe('\t```a*b```');
  });

  it('converts lists too, as if their own option were on', () => {
    const settings = openProject(
      writeFixture({
        items: ITEMS,
        compile: ({ projectSettings: { options } }) => {
          delete options.convertTablesAndListsToMmd;
          options.convertRichTextToMmd = on;
        },
      }),
    );
    expect(readModel(settings).settings.text.convertLists).toBe(true);
  });
});
