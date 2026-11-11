import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { canonical, same, type RichDocument } from './rich-text.ts';
import { readRichText } from './rich-text-reader.ts';
import { rewriteRichText } from './rich-text-rewrite.ts';
import { writeRichText } from './rich-text-writer.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures');

const rtfFiles = fs
  .readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.rtf'))
  .map((file) => path.join(FIXTURES, file));

/** A document read, written from its model alone, and read again. */
const again = (document: RichDocument) => readRichText(writeRichText(document));

/** A Cocoa document around `body`, with two fonts and two colours. */
const cocoa = (body: string) =>
  '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2869\n\\cocoatextscaling0\\cocoaplatform0' +
  '{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;\\f1\\fnil\\fcharset0 Menlo-Regular;}\n' +
  '{\\colortbl;\\red255\\green255\\blue255;\\red85\\green170\\blue255;}\n' +
  '{\\*\\expandedcolortbl;;\\csgenericrgb\\c33333\\c66667\\c100000;}\n\\deftab720\n' +
  `${body}}`;

const chinese = (body: string) =>
  `{\\rtf1\\ansi\\ansicpg1252{\\fonttbl\\f0\\fnil\\fcharset0 Helvetica;\\f1\\fnil\\fcharset134 STSong;\\f2\\fnil\\fcharset99 Odd;}\n${body}}`;

describe("a font's code page", () => {
  it("reads a list marker's bytes as that page's characters", () => {
    const { paragraphs } = readRichText(
      chinese(String.raw`{\listtext\f1 \'b3\'f3}\f0 a\
`),
    );
    expect(paragraphs[0]?.marker?.map(({ text }) => text).join('')).toBe('\u4E11');
  });

  it("keeps the document's page in a font of its own or an unknown one", () => {
    const { paragraphs } = readRichText(chinese(String.raw`\f0 \'e9\f2 \'e9`));
    expect(paragraphs[0]?.content.map(({ text }) => text).join('')).toBe('éé');
  });

  it('skips the bytes that stand in for a character', () => {
    const { paragraphs } = readRichText(chinese(String.raw`\f1\uc2 \u19985 \'b3\'f3 a`));
    expect(paragraphs[0]?.content[0]?.text).toBe('\u4E11 a');
  });

  it('writes the same text back', () => {
    const source = chinese(String.raw`\f1 \'b3\'f3 a`);
    const document = readRichText(source);
    expect(rewriteRichText(source, document)).toBe(source);
    expect(again(document).paragraphs[0]?.content[0]?.text).toBe('\u4E11 a');
  });
});

describe('rich text', () => {
  it('writes every fixture document from its model to the same model', () => {
    const changed = rtfFiles.filter((file) => {
      const document = readRichText(fs.readFileSync(file, 'latin1'));
      return !same(document, again(document));
    });
    expect(changed).toEqual([]);
  });

  it('reads character formatting into values, fonts and colours included', () => {
    const document = readRichText(
      cocoa(
        '\\pard\\tx720\\tqr\\tx1440\\pardeftab720\\li10\\fi-5\\ri3\\sl288\\slmult1\\sb2\\sa4\\qc\\pardirnatural\\partightenfactor0\n\n' +
          '\\f1\\fs29\\fsmilli14700 \\cf2 \\cb1 \\b\\i\\ul\\ulc2 \\strike\\strikec2 a\\b0\\i0\\ulnone\\strike0 ' +
          '\\expnd2\\expndtw10\\kerning1\\up6\\super\\outl\\shad\\strokewidth-20\\strokec2\\highlight2 b' +
          "\\dn4\\sub\\nosupersub\\outl0\\shad0\\uldb c\\plain d\\line e\\tab f\\emdash\\~\\-\\_\\{\\}\\\\\\'93\\uc0\\u8212 \\u-3 g\\\n",
      ),
    );
    expect(document.fonts.map((font) => font.name)).toEqual(['Helvetica', 'Menlo-Regular']);
    expect(document.colors[2]).toEqual({
      red: 85,
      green: 170,
      blue: 255,
      expanded: { space: 'csgenericrgb', values: [33_333, 66_667, 100_000] },
    });
    const [paragraph] = document.paragraphs;
    expect(paragraph!.format).toEqual({
      tabs: [{ position: 720 }, { position: 1440, kind: 'tqr' }],
      defaultTab: 720,
      leftIndent: 10,
      firstIndent: -5,
      rightIndent: 3,
      lineSpacing: { twips: 288, multiple: 1 },
      spaceBefore: 2,
      spaceAfter: 4,
      alignment: 'center',
      naturalDirection: true,
      tightenFactor: 0,
    });
    expect(paragraph!.content.map((run) => run.text)).toEqual([
      'a',
      'b',
      'c',
      `d\u2028e\tf—\u00a0\u00ad\u2011{}\\“—\ufffdg`,
    ]);
    expect(paragraph!.content[0]!.format).toMatchObject({
      font: { name: 'Menlo-Regular' },
      size: 14.7,
      bold: true,
      italic: true,
      underline: { style: 'ul', color: document.colors[2] },
      strike: { style: 'strike', color: document.colors[2] },
      color: document.colors[2],
      background: document.colors[1],
    });
    expect(paragraph!.content[1]!.format).toMatchObject({
      expand: { quarterPoints: 2, twips: 10 },
      kerning: 1,
      baseline: 6,
      script: 'super',
      outline: true,
      shadow: true,
      stroke: { width: -20, color: document.colors[2] },
      highlight: document.colors[2],
    });
    expect(paragraph!.content[2]!.format).toMatchObject({ baseline: -4, script: 'none' });
    expect(paragraph!.content[3]!.format).toEqual({});
    expect(same(document, again(document))).toBe(true);
  });

  it('reads links, list markers, table rows and the older RTF Scrivener for Windows writes', () => {
    const windows =
      '{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0\n{\\fonttbl{\\f0\\fnil\\fcharset0\\fprq2 Georgia;}}\n' +
      '{\\colortbl;\\red0\\green0\\blue0;}\n\\paperw12240\\margl1800\\f0\\fs24\\cf0\n' +
      '\\pard\\plain \\ltrch\\loch {\\f0\\fs24\\b0 Hello }{\\field{\\*\\fldinst HYPERLINK "https://x.test"}{\\fldrslt\\f0 site}}' +
      '{\\field{\\*\\fldinst PAGE}{\\fldrslt 3}}{\\*\\unknown hidden}{\\info{\\title t}}\\par\n' +
      '\\pard\\ls1\\ilvl0{\\listtext\t\\f0 1.\t}One\\par\n' +
      '\\itap1\\trowd \\clmgf\\cellx4320\\clmrg\\cellx8640\n\\pard\\intbl\\itap1 a\\cell b\\cell \\row\n' +
      '\\pard\\f7\\ul0\\foo3 x}';
    const document = readRichText(windows);
    expect(document.settings).toMatchObject({ deff: 0, paperw: 12_240, margl: 1800 });
    expect(document.fonts).toEqual([
      { name: 'Georgia', family: 'nil', charset: 0, other: { fprq: 2 } },
    ]);
    const [hello, item, cellA, cellB, last] = document.paragraphs;
    expect(hello!.content.map((run) => [run.text, run.format.field])).toEqual([
      ['Hello ', undefined],
      ['site', 'HYPERLINK "https://x.test"'],
      ['3', 'PAGE'],
    ]);
    expect(item!.format.list).toEqual({ override: 1, level: 0 });
    expect(item!.marker!.map((run) => run.text).join('')).toBe('\t1.\t');
    expect(cellA!.row).toEqual({
      depth: 1,
      borders: {},
      cells: [
        { right: 4320, borders: {}, padding: {}, merge: 'first' },
        { right: 8640, borders: {}, padding: {}, merge: 'rest' },
      ],
    });
    expect([cellA!.end.kind, cellB!.end.kind]).toEqual(['cell', 'row']);
    expect(cellA!.format.table).toEqual({ depth: 1, inTable: true });
    expect(last!.end.kind).toBe('document');
    expect(last!.content[0]!.format.other).toMatchObject({ f: 7, foo: 3 });
    expect(same(document, again(document))).toBe(true);
  });

  it('writes fonts and colours the text uses that the tables do not list', () => {
    const document = readRichText(cocoa('\\pard\\f0 a\\\n'));
    const [run] = document.paragraphs[0]!.content;
    run!.format = {
      ...run!.format,
      font: { name: 'Courier', family: 'modern' },
      color: { red: 1, green: 2, blue: 3 },
      underline: { style: 'none' },
      strike: { style: 'none' },
      stroke: { color: null },
    };
    const written = again(document);
    expect(written.fonts.map((font) => font.name)).toEqual([
      'Helvetica',
      'Menlo-Regular',
      'Courier',
    ]);
    expect(written.colors.at(-1)).toEqual({ red: 1, green: 2, blue: 3 });
    expect(written.paragraphs[0]!.content[0]!.format).toEqual(run!.format);
  });

  it('reads RTF written oddly, and writes what it read to the same model', () => {
    const odd =
      "{\\rtf1\\uc\\deftab{\\fonttbl stray;\\f\\fcharset\\fprq\\fnil Plain;\\f1\\fnil Na\\'e9me;" +
      "{\\f2\\froman Grouped;}}{\\colortbl;\\red\\green;\\alpha5\\'41{x}\\blue9 ab;}" +
      "{\\*\\expandedcolortbl;\\c zz;\\csgray\\'41{x}\\c50000;}" +
      '{plain group}{\\*\\x \\par}\\row\\u\\uc2\\u8212 ab\\|c' +
      '{\\field{\\fldinst X}{\\other y}{text}{\\fldrslt r}}' +
      '\\tqc\\tx100\\tqdec\\tx200\\ls\\ilvl\\li\\fi\\ri\\sb\\sa\\sl\\slmult\\pardeftab\\partightenfactor\\itap\\intbl ' +
      '\\fs\\fsmilli\\cf\\cb\\highlight\\expnd\\expndtw\\kerning\\up\\dn\\strokewidth\\ulc\\strikec ' +
      'd\\ul0\\striked1\\strikec2 e\\uc0\\u-10179 \\u-8704 \\par' +
      '\\pard\\ql\\slmult1\\ilvl2{\\field{\\*\\fldinst{HYPERLINK "a\\\\b\\|\\\'41"\\f0}}{\\fldrslt l}}\\par' +
      '\\pard\\tx{\\*\\x \\' +
      '\n}\\plain\\f\\expndtw5\\ulc2\\ul m\\par}';
    const document = readRichText(odd);
    expect(document.fonts.map((font) => font.name)).toEqual(['Plain', 'Naéme', 'Grouped']);
    expect(document.colors.slice(1)).toEqual([
      { red: 0, green: 0, blue: 0 },
      { red: 0, green: 0, blue: 9, expanded: { space: 'csgray', values: [50_000] } },
    ]);
    const text = document.paragraphs.flatMap((paragraph) =>
      paragraph.content.map((run) => run.text),
    );
    expect(text.join('')).toBe('plain group—crde😀lm');
    expect(document.paragraphs.at(-2)!.content[0]!.format.field).toBe('HYPERLINK "a\\bA"');
    expect(document.paragraphs.at(-1)!.content[0]!.format).toEqual({
      font: document.fonts[0],
      expand: { quarterPoints: 0, twips: 5 },
      underline: { style: 'ul', color: document.colors[2] },
    });
    expect(same(document, again(document))).toBe(true);
    const lastRun = document.paragraphs.at(-1)!.content.at(-1)!;
    lastRun.format = { ...lastRun.format, underline: { style: 'ul' } };
    expect(same(again(document), document)).toBe(true);
  });

  it('reads RTF with no outer group, and writes a document with no colour table', () => {
    expect(readRichText('plain {\\colortbl;\\red1 x\\green2;}text').paragraphs).toEqual([
      {
        format: {},
        content: [{ text: 'plain text', format: {} }],
        end: { kind: 'document', format: {} },
      },
    ]);
    const bare = readRichText('{\\rtf1 a}');
    expect(bare.colors).toEqual([]);
    expect(same(again(bare).paragraphs, bare.paragraphs)).toBe(true);
  });

  it('reads table rows and lists into values, and writes them back to the same', () => {
    const document = readRichText(
      cocoa(
        '{\\*\\listtable{\\list\\listtemplateid1\\listhybrid\\listsimple{\\listlevel\\levelnfc23\\levelnfcn23' +
          '\\leveljc0\\leveljcn0\\levelfollow0\\levelstartat1\\levelspace360\\levelindent0' +
          "{\\*\\levelmarker \\{disc\\}}{\\leveltext\\leveltemplateid1\\uc1\\'01\\u8226 x;}{\\levelnumbers;}" +
          "\\fi-360\\li720\\lin720\\f1 }{\\listlevel\\levelnfc0{\\leveltext\\'03\\'00.\\'01;}{\\levelnumbers\\'01\\'03;}}" +
          '{\\listname List;}\\listid7}}\n' +
          '{\\*\\listoverridetable{\\listoverride\\listid7\\listoverridecount0\\ls1}}\n' +
          '\\itap1\\trowd \\taflags1 \\trgaph108\\trleft-108 \\trautofit1 \\lastrow \\trbrdrt\\brdrs\\brdrw20\\brdrcf2 ' +
          '\\trbrdrb\\brdrnil \\trfoo2 \\clvertalb \\clcbpat2 \\clshdrawnil \\clvmgf \\clbrdrl\\brdrnil ' +
          '\\clpadt5 \\clpadb6 \\clwWidth300\\clftsWidth3 \\clbar \\gaph\\cellx400\n' +
          '\\pard\\intbl\\itap1\\ls1\\ilvl0 a\\cell \\row\n',
      ),
    );
    const [list] = document.lists;
    expect(list).toMatchObject({
      id: 7,
      templateId: 1,
      hybrid: true,
      name: 'List',
      other: { listsimple: true },
    });
    expect(list!.levels[0]).toMatchObject({
      numberFormat: 23,
      marker: '{disc}',
      text: { templateId: 1, parts: ['•'] },
      firstIndent: -360,
      leftIndent: 720,
      lineIndent: 720,
      other: { f: 1 },
    });
    expect(list!.levels[1]!.text.parts).toEqual([{ level: 0 }, '.', { level: 1 }]);
    expect(document.listOverrides).toEqual([{ listId: 7, count: 0, override: 1 }]);
    const row = document.paragraphs[0]!.row!;
    expect(row).toMatchObject({
      depth: 1,
      flags: 1,
      gap: 108,
      left: -108,
      autofit: true,
      lastRow: true,
      other: { trfoo: 2 },
      borders: {
        top: { style: 'brdrs', width: 20, color: document.colors[2] },
        bottom: { style: 'brdrnil' },
      },
    });
    expect(row.cells[0]).toEqual({
      right: 400,
      verticalAlign: 'bottom',
      background: document.colors[2],
      noShading: true,
      merge: 'top',
      borders: { left: { style: 'brdrnil' } },
      padding: { top: 5, bottom: 6 },
      width: { value: 300, units: 3 },
      gap: true,
      other: { clbar: true },
    });
    expect(same(document, again(document))).toBe(true);
  });

  it('reads lists and rows written with words left out', () => {
    const document = readRichText(
      cocoa(
        "{\\*\\listtable stray{\\other}{\\list junk{\\listlevel junk\\levelnfc\\levelfoo{\\leveltext\\'02xz{y}\\|;}{\\other}}" +
          '{\\listname ;}\\listid}}\n{\\*\\listoverridetable{x}{\\listoverride junk\\listid\\listoverridecount\\ls\\lsfoo}}\n' +
          '\\clpadl5\\brdrcf1\\cellx10\\trowd\\trbrdrt\\brdrcf99 \\clbrdrr\\brdrw5 \\clcbpat99 \\trautofit0 \\cellx\n' +
          '\\pard a\\\n',
      ),
    );
    expect(document.lists).toEqual([
      {
        id: 0,
        hybrid: false,
        name: '',
        levels: [{ numberFormat: 0, text: { parts: ['xz'] }, other: { levelfoo: true } }],
      },
    ]);
    expect(document.listOverrides).toEqual([{ listId: 0, count: 0, override: 0 }]);
    expect(document.paragraphs[0]!.row).toEqual({
      depth: 1,
      autofit: false,
      borders: { top: { color: null } },
      cells: [{ right: 0, borders: { right: { width: 5 } }, padding: {}, background: null }],
    });
    expect(same(document, again(document))).toBe(true);
  });

  it('starts over with \\plain where formatting goes back to the default', () => {
    const document = readRichText(cocoa('\\pard\\b\\foo a\\\n'));
    document.paragraphs[0]!.content.push({ text: 'b', format: {} });
    const written = writeRichText(document);
    expect(written).toContain('\\plain ');
    expect(same(readRichText(written), document)).toBe(true);
  });
});

describe('same', () => {
  it('finds values equal as their canonical text would, key order and empty keys aside', () => {
    const cases: [unknown, unknown, boolean][] = [
      [{ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 }, true],
      [{ a: 1, gone: undefined }, { a: 1 }, true],
      [{ a: 1 }, { a: 1, b: 2 }, false],
      [{ a: 1 }, { b: 1 }, false],
      [[1, 2], [1, 2, 3], false],
      [[1], { 0: 1 }, false],
      [{ 0: 1 }, [1], false],
      [1, '1', false],
      [null, {}, false],
      [{}, undefined, false],
    ];
    for (const [a, b, equal] of cases) {
      expect(same(a, b)).toBe(equal);
      expect(same(a, b)).toBe(canonical(a) === canonical(b));
    }
  });
});
