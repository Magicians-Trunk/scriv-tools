import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { findFormat, listFormats, readFormatFile, writeFormat } from './compile-format.ts';
import { type Scrformat } from './scrformat.ts';
import { openProject } from './project.ts';

/** The fixture's format, changed, as the compile reads it. */
const load = (change?: (format: Scrformat) => void) =>
  findFormat(
    openProject(writeFixture({ items: [], ...(change ? { format: change } : {}) })),
    'Fixture Format',
    '',
  );

/** The fixture format's two layouts: Heading, for folders, and Text Section. */
function layouts(format: Scrformat) {
  const [heading, textSection] = format.sectionLayouts;
  return { heading: heading!, textSection: textSection! };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('listFormats', () => {
  it("finds project formats, the user's own formats and Scrivener's built-in formats", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'scrivener-home-'));
    const userFolder = path.join(
      home,
      'Library',
      'Application Support',
      'Scrivener',
      'CompileFormats',
    );
    fs.mkdirSync(userFolder, { recursive: true });
    fs.writeFileSync(
      path.join(userFolder, 'Mine.scrformat'),
      '<CompileFormat Name="Mine" ID="MINE"/>',
    );
    fs.writeFileSync(path.join(userFolder, 'notes.txt'), '');
    const app = path.join(home, 'Scrivener.app');
    const builtIn = path.join(
      app,
      'Contents',
      'Resources',
      'Default Support Folder',
      'CompileFormats',
    );
    fs.mkdirSync(builtIn, { recursive: true });
    fs.writeFileSync(path.join(builtIn, 'Unnamed.scrformat'), '<CompileFormat ID="mmd-x"/>');
    vi.stubEnv('HOME', home);
    vi.stubEnv('SCRIVENER_APP', app);

    const formats = listFormats(openProject(writeFixture({ items: [] })));

    expect(formats.map(({ name, id, source }) => ({ name, id, source }))).toEqual([
      { name: 'Fixture Format', id: 'FMT', source: 'project' },
      { name: 'Mine', id: 'MINE', source: 'user' },
      { name: 'Unnamed', id: 'mmd-x', source: 'built-in' },
    ]);
  });

  it('stops on a file that is not a compile format', () => {
    const project = writeFixture({ items: [] });
    const file = path.join(project, 'Settings', 'Compile Formats', 'Fixture-Format.scrformat');
    fs.writeFileSync(file, '<Other/>');
    expect(() => listFormats(openProject(project))).toThrow('has no <CompileFormat> element.');
  });
});

describe('writeFormat', () => {
  it('writes a format back as it was read, and refuses one read without parts Scrivener writes', () => {
    const project = writeFixture({ items: [] });
    const file = path.join(project, 'Settings', 'Compile Formats', 'Fixture-Format.scrformat');
    expect(writeFormat(readFormatFile(file, 'project'))).toBe(fs.readFileSync(file, 'utf8'));
    const built = path.join(
      import.meta.dirname,
      '..',
      'test',
      'fixtures',
      'basic.scriv',
      'Settings',
      'Compile Formats',
      'Fixture-MultiMarkdown.scrformat',
    );
    expect(() => writeFormat(readFormatFile(built, 'project'))).toThrow(
      'Unsupported: writing the compile format "Fixture MultiMarkdown", which holds a missing',
    );
  });
});

describe('findFormat', () => {
  it('finds a format by name, file name, path, or as the last one used', () => {
    const project = openProject(writeFixture({ items: [] }));
    const file = path.join(project.dir, 'Settings', 'Compile Formats', 'Fixture-Format.scrformat');
    for (const request of ['Fixture Format', 'Fixture-Format', file, undefined]) {
      expect(findFormat(project, request, 'FMT').name).toBe('Fixture Format');
    }
  });

  it('names what it looked for and what it found', () => {
    vi.stubEnv('SCRIVENER_APP', '/nowhere');
    const project = openProject(writeFixture({ items: [] }));
    expect(() => findFormat(project, 'Nope', 'FMT')).toThrow(
      'Compile format not found: Nope.  Found: Fixture Format',
    );
    expect(() => findFormat(project, undefined, '')).toThrow('the last used format (none)');
  });

  it('reads separators: returns leave an empty line, page breaks and custom text their own line', () => {
    const format = load((model) => {
      layouts(model).textSection.separators = {
        useDefault: false,
        before: { type: 'Single', text: '' },
        between: { type: 'PageBreak', text: '' },
        afterOverride: { use: true, type: 'Custom', text: '@' },
      };
    });
    expect(format.layouts.get('L-TEXT')?.separators).toEqual({
      before: '\n\n',
      between: '\n\n----\n\n',
      after: '\n@\n',
    });
    expect(format.folderSeparators).toEqual({ before: '\n\n', between: '\n\n' });
  });

  it('reads title options, placement, metadata, uppercased words and blank line separators', () => {
    const heading = load((model) => {
      Object.assign(layouts(model).heading, {
        titles: {
          prefix: { text: 'Ch ' },
          suffix: { hashesInside: true, text: ' |' },
          mmdHashCount: 0,
          titleCase: 'Uppercase',
          runInHead: true,
        },
        uppercasedFirstWords: 2,
        pagePadding: 3,
      });
    }).layouts.get('L-HEADING');
    expect(heading).toMatchObject({
      titles: {
        prefix: 'Ch ',
        suffix: ' |',
        suffixAfterHashes: true,
        hashCount: 0,
        titleCase: 'Uppercase',
        runIn: true,
      },
      uppercasedWords: 2,
      prefixAfterTitle: false,
    });
    const text = load((model) => {
      const { textSection } = layouts(model);
      textSection.include = { metadata: true, text: true };
      textSection.prefix!.afterTitle = true;
      textSection.suffix!.afterSubdocs = true;
      textSection.blankLineSeparator = { text: '* * *' };
    }).layouts.get('L-TEXT');
    expect(text).toMatchObject({
      includeMetadata: true,
      prefixAfterTitle: true,
      suffixAfterSubdocuments: true,
      blankLineSeparator: '* * *',
      titles: {
        prefix: '',
        suffix: '',
        suffixAfterHashes: false,
        titleCase: 'Normal',
        runIn: false,
      },
    });
  });

  it('reads how kept annotations and comments are written', () => {
    const format = load((model) => {
      model.footnotesAndComments = {
        comments: {
          annotationPrefix: '{>>',
          annotationSuffix: '<<}',
          commentFormat: { use: true, template: '[<$lnk>: <$cmt>]' },
        },
      };
    });
    expect(format).toMatchObject({
      annotationPrefix: '{>>',
      annotationSuffix: '<<}',
      commentFormat: '[<$lnk>: <$cmt>]',
    });
    expect(load().commentFormat).toBe('<$lnk> <$cmt>');
  });

  it('reads a metadata value with no key as one with an empty key', () => {
    const format = load((model) => void (model.mmd!.metadata = [{ value: 'x' }]));
    expect(format.metadata).toEqual([{ key: '', value: 'x' }]);
  });

  it('reads a format with no transformations and no MultiMarkdown style functions', () => {
    const format = load((model) => {
      delete model.transformations;
      delete model.styles;
      delete model.mmd;
    });
    expect(format).toMatchObject({ removeSmartPunctuation: false });
    expect([format.blockQuoteStyle, format.codeBlockStyle, format.codeSpanStyle]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it.each([
    [
      (model: Scrformat) => void (model.supportedTypes = ['txt']),
      'format "Fixture Format" does not compile to MultiMarkdown',
    ],
    [(model: Scrformat) => void (model.postProcessing = { enabled: true }), 'post-processing'],
    [
      (model: Scrformat) =>
        void (model.transformations!.plainTextConversion = {
          state: 'On',
          conversion: 'Spacing+Indents',
        }),
      'transformation PlainTextConversion Spacing+Indents',
    ],
    [
      (model: Scrformat) => void (model.transformations!.outlineIndent!.state = 'On'),
      'transformation OutlineIndent',
    ],
    [
      (model: Scrformat) => void (layouts(model).heading.titles = { titleCase: 'Wavy' }),
      'section layout "Heading" title case Wavy',
    ],
    [
      (model: Scrformat) => {
        layouts(model).heading.separators = {
          useDefault: false,
          before: { type: 'Weird', text: '' },
          between: { type: 'Single', text: '' },
          afterOverride: { use: false, type: 'Single', text: '' },
        };
      },
      'separator type Weird',
    ],
    [
      (model: Scrformat) => void (model.tables = { convertToImages: { convert: true } }),
      'tables converted to images',
    ],
    [
      (model: Scrformat) => void (model.mmd!.pageTitleStyleId = 'F-HEADING'),
      'MultiMarkdown setting PageTitleStyleID',
    ],
  ] satisfies [(model: Scrformat) => void, string][])(
    'stops on an unsupported setting: %#',
    (change, feature) => {
      expect(() => load(change)).toThrow(`Unsupported: ${feature}`);
    },
  );

  it.each([
    ['<SectionLayouts>', '<Mystery/><SectionLayouts>', 'a Mystery element in CompileFormat'],
    ['<UsePandocSyntax>', '<Odd/><UsePandocSyntax>', 'a Odd element in MMD'],
    ['<Prefix><![CDATA[# ]]>', '<Odd/><Prefix><![CDATA[# ]]>', 'a Odd element in Style'],
    ['<Replacement>', '<Replacement WholeWord="Yes">', 'the WholeWord attribute of Replacement'],
  ])('stops on what the format holds that it does not know: %s', (from, to, feature) => {
    const project = writeFixture({
      items: [],
      format: (model) => void (model.replacements = [{ replace: 'a', with: 'b' }]),
    });
    const file = path.join(project, 'Settings', 'Compile Formats', 'Fixture-Format.scrformat');
    const xml = fs.readFileSync(file, 'utf8');
    expect(xml).toContain(from);
    fs.writeFileSync(file, xml.replace(from, to));
    expect(() => findFormat(openProject(project), 'Fixture Format', '')).toThrow(
      `Unsupported: compile format "Fixture Format" holding ${feature}`,
    );
  });
});
