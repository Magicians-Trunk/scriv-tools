import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { rtfDocument } from '../test/rtf-builder.ts';
import { same, type RichDocument, type RichParagraph } from './rich-text.ts';
import { readRichText } from './rich-text-reader.ts';
import { rewriteRichText } from './rich-text-rewrite.ts';
import { writeRichText } from './rich-text-writer.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures');

const rtfFiles = fs
  .readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.rtf'))
  .map((file) => path.join(FIXTURES, file));

/** A Cocoa document around `body`, with two fonts and two colours, `\uc0` set where it is. */
const cocoa = (body: string) =>
  '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2869\n\\cocoatextscaling0\\cocoaplatform0' +
  '{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;\\f1\\fnil\\fcharset0 Menlo-Regular;}\n' +
  '{\\colortbl;\\red255\\green255\\blue255;\\red85\\green170\\blue255;}\n' +
  '{\\*\\expandedcolortbl;;\\csgenericrgb\\c33333\\c66667\\c100000;}\n\\deftab720\n' +
  `${body}}`;

const PLAIN = '\\pard\\pardeftab720\\partightenfactor0\n\n\\f0\\fs24 \\cf0 ';

/** The document read from `source`, changed by `change`, written over the source. */
function rewritten(source: string, change: (document: RichDocument) => void) {
  const document = readRichText(source);
  change(document);
  const written = rewriteRichText(source, document);
  return { document, written, read: readRichText(written) };
}

const paragraph = (text: string): RichParagraph => ({
  format: {},
  content: [{ text, format: {} }],
  end: { kind: 'paragraph', format: {} },
});

describe('rewriteRichText', () => {
  it('writes every fixture document, unchanged, as its source', () => {
    const changed = rtfFiles.filter((file) => {
      const source = fs.readFileSync(file, 'latin1');
      return rewriteRichText(source, readRichText(source)) !== source;
    });
    expect(changed).toEqual([]);
  });

  it('keeps the source around a changed paragraph, and the change reads back', () => {
    const source = cocoa(`${PLAIN}one\\\n\\b two\\b0 \\\nthree`);
    const { document, written, read } = rewritten(source, (changed) => {
      changed.paragraphs[1]!.content[0]!.text = 'TWO, café';
    });
    expect(read).toEqual(document);
    expect(written.startsWith(cocoa(`${PLAIN}one\\\n`).slice(0, -1))).toBe(true);
    expect(written.endsWith('three}')).toBe(true);
  });

  it('keeps the source where paragraphs are added, taken away and moved', () => {
    const source = cocoa(`${PLAIN}a\\\nb\\\nc\\\nd\\\ne\\\n`);
    const changes: ((document: RichDocument) => void)[] = [
      ({ paragraphs }) => void paragraphs.splice(2, 0, paragraph('new')),
      ({ paragraphs }) => void paragraphs.splice(2, 1),
      ({ paragraphs }) => void paragraphs.splice(1, 0, ...paragraphs.splice(3, 1)),
      (changed) => {
        changed.paragraphs = changed.paragraphs.toReversed();
      },
    ];
    for (const change of changes) {
      const { document, written, read } = rewritten(source, change);
      expect(read).toEqual(document);
      expect(written).not.toBe(writeRichText(document));
    }
  });

  it('sets `\\uc0` for text it writes and puts the source’s back after', () => {
    const source = cocoa(`\\uc1 ${PLAIN}\\u8226 ?a\\\nb\\\n\\u8226 ?c\\\n`);
    const { document, written, read } = rewritten(source, (changed) => {
      changed.paragraphs[1]!.content[0]!.text = '\u2192b';
    });
    expect(read).toEqual(document);
    expect(written).toContain('a\\\n\\uc0 \\u8594 b\\\n\\uc1 \\u8226 ?c');
  });

  it('keeps a table row whole, and writes the row anew when a cell changes', () => {
    const row =
      '\\itap1\\trowd \\cellx100\\cellx200\n\\pard\\intbl\\itap1 x\\cell \\pard\\intbl\\itap1 y\\cell \\row\n';
    const source = cocoa(`${PLAIN}before\\\n${row}\\pard\\tqr\\tx100 after\\\n`);
    expect(rewriteRichText(source, readRichText(source))).toBe(source);
    const { document, read } = rewritten(source, (changed) => {
      changed.paragraphs[2]!.content[0]!.text = 'Y';
    });
    expect(read).toEqual(document);
  });

  it('adds the fonts and colours a change uses to the ends of the source’s tables', () => {
    const source = cocoa(`${PLAIN}a\\\nb\\\nc`);
    const expanded = { space: 'csgenericrgb', values: [1, 2, 3] };
    const { document, written, read } = rewritten(source, (changed) => {
      const { format } = changed.paragraphs[0]!.content[0]!;
      format.color = { red: 1, green: 2, blue: 3 };
      format.font = { name: 'Zapfino', family: 'nil', charset: 0 };
      format.background = { red: 4, green: 5, blue: 6, expanded };
      changed.fonts.push({ name: 'Listed', family: 'roman' });
    });
    expect(read).toEqual(readRichText(writeRichText(document)));
    expect(written).toContain('\\f1\\fnil\\fcharset0 Menlo-Regular;\\f2\\froman Listed;\\f3\\fnil');
    expect(written).toContain('\\blue255;\\red1\\green2\\blue3;\\red4\\green5\\blue6;}');
    expect(written).toContain('\\c100000;;\\csgenericrgb\\c1\\c2\\c3;}');
    expect(written.endsWith('b\\\nc}')).toBe(true);
  });

  it('adds a plain colour to a source with no expanded colour table', () => {
    const fonts = '{\\fonttbl\\f0\\fswiss Helvetica;}';
    const source = `{\\rtf1\\ansi\\uc0${fonts}{\\colortbl;\\red1\\green1\\blue1;}\n${PLAIN}a\\\nb}`;
    const { document, written, read } = rewritten(source, (changed) => {
      changed.paragraphs[0]!.content[0]!.format.color = { red: 9, green: 9, blue: 9 };
    });
    expect(read).toEqual(readRichText(writeRichText(document)));
    expect(written).toContain('{\\colortbl;\\red1\\green1\\blue1;\\red9\\green9\\blue9;}');
    expect(written.endsWith('\\\nb}')).toBe(true);
  });

  it('writes anew when a table it needs is missing or a listed entry changed', () => {
    const missing = [
      // An expanded colour, where the source has no expanded colour table.
      `{\\rtf1\\ansi{\\colortbl;\\red1\\green1\\blue1;}\n${PLAIN}a\\\nb}`,
      // A colour, where the source has no colour table.
      `{\\rtf1\\ansi\n${PLAIN}a\\\nb}`,
    ];
    for (const source of missing) {
      const { document, written } = rewritten(source, (changed) => {
        changed.paragraphs[0]!.content[0]!.format.color = {
          red: 9,
          green: 9,
          blue: 9,
          expanded: { space: 'csgenericrgb', values: [1, 2, 3] },
        };
      });
      expect(written).toBe(writeRichText(document));
    }
    const source = cocoa(`${PLAIN}a\\\nb`);
    for (const change of [
      (changed: RichDocument) => void changed.fonts.pop(),
      (changed: RichDocument) => void changed.colors.splice(1, 1),
      (changed: RichDocument) => void (changed.settings.deftab = 360),
    ]) {
      const { document, written } = rewritten(source, change);
      expect(written).toBe(writeRichText(document));
    }
  });

  it('writes anew a source with no document group', () => {
    const loose = rewritten('a\\\nb', (changed) => {
      changed.paragraphs[0]!.content[0]!.text = 'A';
    });
    expect(loose.written).toBe(writeRichText(loose.document));
    expect(rewriteRichText('', readRichText(''))).toBe('');
  });

  it('keeps a header with no text after it, or text straight after it', () => {
    for (const source of ['{\\rtf1\\ansi\\uc0\n}', "{\\rtf1\\ansi\n\\'97a}"]) {
      expect(rewriteRichText(source, readRichText(source))).toBe(source);
    }
  });

  it('writes anew a document that keeping the source would not give back', () => {
    // A paragraph moved after the last, whose end has no mark, joins it when read.
    const source = cocoa(`${PLAIN}a\\\nb`);
    const document = readRichText(source);
    document.paragraphs = document.paragraphs.toReversed();
    expect(rewriteRichText(source, document)).toBe(writeRichText(document));
  });

  it('matches paragraphs only at the ends when too many changed to match the rest', () => {
    const body = Array.from({ length: 2100 }, (_, index) => `p${index}\\\n`).join('');
    const source = cocoa(`${PLAIN}${body}`);
    const { document, read } = rewritten(source, (changed) => {
      changed.paragraphs = changed.paragraphs.toReversed();
    });
    expect(same(read, document)).toBe(true);
  });
});

describe('a document with an embedded picture', () => {
  const PICTURE = String.raw`{\*\shppict{\pict\picw1\pich1\jpegblip ffd8}}`;
  const source = rtfDocument(`one\\\n${PICTURE}\\\ntwo`);

  it('keeps the picture when its text changes', () => {
    const document = readRichText(source);
    document.paragraphs[0]!.content[0]!.text = 'changed';
    const written = rewriteRichText(source, document);
    expect(written).toContain('ffd8');
    expect(written).toContain('changed');
  });

  it('keeps the picture when the document gains a list', () => {
    const document = readRichText(source);
    const level = readRichText(rtfDocument('')).lists[0]!;
    document.lists = [...document.lists, { ...level, id: 99 }];
    document.listOverrides = [...document.listOverrides, { listId: 99, count: 0, override: 99 }];
    const written = rewriteRichText(source, document);
    expect(written).toContain('ffd8');
    expect(readRichText(written).lists.at(-1)?.id).toBe(99);
  });

  it('keeps the picture when a list changes in place', () => {
    const listed = rtfDocument(`one\\\n${PICTURE}\\\ntwo`);
    const document = readRichText(listed);
    const [list] = document.lists;
    document.lists = [{ ...list!, name: 'changed' }, ...document.lists.slice(1)];
    const written = rewriteRichText(listed, document);
    expect(written).toContain('ffd8');
    expect(readRichText(written).lists[0]?.name).toBe('changed');
  });

  it('keeps the picture when the document is written anew', () => {
    const document = readRichText(source);
    document.settings = { ...document.settings, deftab: 1 };
    expect(rewriteRichText(source, document)).toContain('ffd8');
  });

  it('keeps a picture in the paragraph that changes, and names it', () => {
    const named = String.raw`{\*\shppict{\pict {\*\nisusfilename shot_1}\picw1\pich1\pngblip ffd8}}`;
    const together = rtfDocument(`one ${named} two`);
    const document = readRichText(together);
    document.paragraphs[0]!.content[0]!.text = 'changed ';
    const written = rewriteRichText(together, document);
    expect(written).toContain('ffd8');
    const [, run] = readRichText(written).paragraphs[0]!.content;
    expect(run?.format.picture).toMatchObject({ name: 'shot_1', extension: 'png' });
  });

  it('reads no picture inside what a reader skips', () => {
    const skipped = rtfDocument(String.raw`one{\*\unknown{\pict\jpegblip ffd8}}`);
    expect(readRichText(skipped).paragraphs[0]?.content).toHaveLength(1);
  });

  it('writes a picture that repeats once for each', () => {
    const twice = rtfDocument(`${PICTURE}${PICTURE}`);
    const document = readRichText(twice);
    document.settings = { ...document.settings, deftab: 1 };
    expect(rewriteRichText(twice, document).match(/ffd8/g)).toHaveLength(2);
  });
});

describe('a document with no list tables', () => {
  it('gains them, keeping its text as it was', () => {
    const source = String.raw`{\rtf1\ansi{\fonttbl\f0\fnil Helvetica;}{\colortbl;}\pard\f0 one\
two}`;
    const document = readRichText(source);
    const list = { id: 1, hybrid: true, name: '', levels: [] };
    document.lists = [list];
    document.listOverrides = [{ listId: 1, count: 0, override: 1 }];
    const written = rewriteRichText(source, document);
    expect(written).toContain('\\listtable');
    expect(written).toContain('\\listoverridetable');
    expect(readRichText(written).lists).toHaveLength(1);
  });
});
