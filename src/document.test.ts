import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { STYLES, writeFixture } from '../test/fixture.ts';
import { rtfDocument } from '../test/rtf-builder.ts';
import { documentRichText, keptDocuments, projectDocuments, writeComments } from './document.ts';
import { memoryFiles } from './memory-files.ts';
import { same } from './rich-text.ts';
import { readRichText } from './rich-text-reader.ts';
import { unreadList } from './xml-codec.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures');

describe('projectDocuments', () => {
  it('reads every fixture document whole: its model gives back the rich text it was read from', () => {
    const incomplete: string[] = [];
    for (const name of fs.readdirSync(FIXTURES).filter((file) => file.endsWith('.scriv'))) {
      const dir = path.join(FIXTURES, name);
      const documents = projectDocuments(dir);
      const data = path.join(dir, 'Files', 'Data');
      for (const file of fs.readdirSync(data, { recursive: true, encoding: 'utf8' })) {
        const [id, rtfFile] = file.split(path.sep);
        if (rtfFile !== 'content.rtf' && rtfFile !== 'notes.rtf') continue;
        const source = fs.readFileSync(path.join(data, file), 'latin1');
        const document = documents.text(id!, rtfFile === 'notes.rtf' ? 'notes' : 'content');
        if (!same(documentRichText(document), readRichText(source)) || document.source !== source) {
          incomplete.push(file);
        }
      }
    }
    expect(incomplete).toEqual([]);
  });

  it("reads the style IDs a document's markers number, its synopsis, and nothing for no files", () => {
    const dir = writeFixture({
      items: [
        { id: 'A', text: '<$Scr_Cs::1>a<!$Scr_Cs::1>', styles: [STYLES.codeSpan, 'GONE'] },
        { id: 'B', text: 'b', synopsis: 'first' },
        { id: 'C' },
      ],
    });
    const documents = projectDocuments(dir);
    const [paragraph] = documents.text('A').paragraphs;
    expect(documents.text('A').styleIds).toEqual([STYLES.codeSpan, 'GONE']);
    expect(paragraph!.content[0]).toMatchObject({ kind: 'style', index: 1 });
    expect(documents.text('B').styleIds).toEqual([]);
    expect(documents.synopsis('B')).toBe('first');
    expect(documents.synopsis('C')).toBe('');
    expect(documents.text('C')).toMatchObject({ paragraphs: [], source: '' });
  });
});

describe('a comments file as current Scrivener writes it', () => {
  it('reads and writes it back in that form, a linked footnote included', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: 'one' }] });
    const file = path.join(dir, 'Files', 'Data', 'A', 'content.comments');
    const text = rtfDocument('note');
    fs.writeFileSync(
      file,
      `<?xml version="1.0" encoding="UTF-8"?>\n<Comments>\n    <Comment ID="C" Footnote="Yes" Color="0.1 0.2 0.3"><![CDATA[${text}]]></Comment>\n</Comments>\n`,
    );
    const document = projectDocuments(dir).text('A');
    expect(document.comments[0]).toMatchObject({ id: 'C', footnote: true });
    expect(document.commentsVersion).toBeUndefined();
    expect(unreadList(document.unsupported)).toEqual([]);
    const written = writeComments(document);
    expect(written).toContain('<Comments>');
    expect(written).toContain('Footnote="Yes"');
    expect(written).not.toContain('Collapsed');
    expect(written.endsWith('</Comments>')).toBe(true);
  });

  it('keeps an older file in the form it was read', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: 'one' }] });
    const file = path.join(dir, 'Files', 'Data', 'A', 'content.comments');
    const text = rtfDocument('note');
    fs.writeFileSync(
      file,
      `<Comments Version="1.0"><Comment ID="C" Collapsed="No" Color="0.1 0.2 0.3"><![CDATA[${text}]]></Comment></Comments>`,
    );
    const written = writeComments(projectDocuments(dir).text('A'));
    expect(written).toContain('Version="1.0"');
    expect(written).toContain('Collapsed="No"');
  });
});

describe('keptDocuments', () => {
  it('reads a document once while its files hold the same bytes, and again once they change', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: 'one' }] });
    const data = path.join(dir, 'Files', 'Data', 'A');
    const files = memoryFiles(
      fs
        .readdirSync(data)
        .map((name): [string, Uint8Array] => [
          path.join(data, name),
          fs.readFileSync(path.join(data, name)),
        ]),
    );
    const documents = keptDocuments(dir, files);
    const first = documents.text('A');
    expect(documents.text('A')).toBe(first);
    expect(documents.text('A', 'notes')).not.toBe(first);
    files.write(path.join(data, 'content.rtf'), new TextEncoder().encode(rtfDocument('two')));
    const again = documents.text('A');
    expect(again).not.toBe(first);
    expect(again.paragraphs).toHaveLength(1);
    expect(documents.synopsis('A')).toBe('');
  });
});
