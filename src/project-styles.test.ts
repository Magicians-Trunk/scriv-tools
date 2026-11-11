import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { rtfDocument } from '../test/rtf-builder.ts';
import { readDocumentText, writeComments } from './document.ts';
import { type ProjectStyle, styleLook, stylesFile, writeStyles } from './project-styles.ts';
import { newUnread, unreadList } from './xml-codec.ts';
import { parseXml, readXml } from './xml.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'test', 'fixtures');

/** Fixtures whose styles file Scrivener wrote, not the fixture builder. */
const WRITTEN_BY_SCRIVENER = ['blank', 'basic', 'notes', 'tables'];

/** A stylesheet of one style, as Scrivener writes it, with a highlight box or none. */
const codeBlockStyles = (box: string) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Styles>',
    `    <Style Name="Code Block" ID="A" Type="Para+Char" FontChange="Face+Size"${box} Next="A" Shortcut="5">`,
    '        <Format><![CDATA[{\\rtf1 Attributes}]]></Format>',
    '    </Style>',
    '</Styles>',
  ].join('\n');

describe('writeStyles', () => {
  it('writes each styles file Scrivener wrote back as it was, knowing all of it', () => {
    for (const name of WRITTEN_BY_SCRIVENER) {
      const file = path.join(FIXTURES, `${name}.scriv`, 'Files', 'styles.xml');
      const found = newUnread();
      const { styles } = stylesFile.read(readXml(file, 'Styles'), found);
      expect(unreadList(found)).toEqual([]);
      const unsupported = {
        scrivx: newUnread(),
        styles: newUnread(),
        compileSettings: newUnread(),
      };
      expect(writeStyles({ styles, unsupported })).toBe(fs.readFileSync(file, 'utf8'));
    }
  });

  it('writes a highlight box back as Scrivener wrote it, read as its colour', () => {
    const file = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Styles>',
      '    <Style Name="Note" ID="A" Type="Para" Box="0.999995 1.0 0.501967">',
      '        <Format><![CDATA[{\\rtf1 Attributes}]]></Format>',
      '    </Style>',
      '</Styles>',
    ].join('\n');
    const { styles } = stylesFile.read(parseXml(file, 'Styles')!, newUnread());
    expect(styles[0]!.box).toEqual([0.999995, 1, 0.501967]);
    const unsupported = { scrivx: newUnread(), styles: newUnread(), compileSettings: newUnread() };
    expect(writeStyles({ styles, unsupported })).toBe(file);
  });

  it('puts a new highlight box where Scrivener writes one: after FontChange, before Next', () => {
    const { styles } = stylesFile.read(parseXml(codeBlockStyles(''), 'Styles')!, newUnread());
    styles[0]!.box = [102 / 255, 1, 0];
    const unsupported = { scrivx: newUnread(), styles: newUnread(), compileSettings: newUnread() };
    expect(writeStyles({ styles, unsupported })).toBe(codeBlockStyles(' Box="0.4 1.0 0.0"'));
  });

  it('refuses styles read with what it does not know', () => {
    const unsupported = { scrivx: newUnread(), styles: newUnread(), compileSettings: newUnread() };
    unsupported.styles.unknown.add('the Glow attribute of Style');
    expect(() => writeStyles({ styles: [], unsupported })).toThrow(
      'Unsupported: writing the styles file, which holds the Glow attribute of Style',
    );
  });

  it('reads each style with its formatting as a document', () => {
    const file = path.join(FIXTURES, 'basic.scriv', 'Files', 'styles.xml');
    const [title] = stylesFile.read(readXml(file, 'Styles'), newUnread()).styles;
    expect(title).toMatchObject({ name: 'Title', type: 'Para+Char', fontChange: 'Size' });
    expect(title!.format.paragraphs).toHaveLength(1);
  });
});

describe('writeComments', () => {
  it("writes a document's comments as Scrivener writes them, the text as RTF", () => {
    const text = readDocumentText(rtfDocument('A note.'));
    const comments = [{ id: 'C1', collapsed: false, color: [1, 0.5, 0], text }];
    const written = writeComments({ comments, commentsVersion: '1.0', unsupported: newUnread() });
    expect(written).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Comments Version="1.0">\n' +
        `    <Comment ID="C1" Collapsed="No" Color="1.0 0.5 0.0"><![CDATA[${text.source}]]></Comment>\n` +
        '</Comments>\n',
    );
    expect(parseXml(written, 'Comments')).toBeDefined();
    const unsupported = newUnread();
    unsupported.missing.add('a missing Color attribute of Comment');
    expect(() => writeComments({ comments, unsupported })).toThrow(
      'Unsupported: writing the comments file, which holds a missing Color attribute of Comment',
    );
  });
});

describe('styleLook', () => {
  const FONTS = String.raw`{\fonttbl\f0\fswiss Helvetica;\f1\fswiss Helvetica-Bold;\f2\fswiss Helvetica-Oblique;\f3\fnil Menlo-Regular;}`;
  const styled = (type: string, text: string): ProjectStyle => ({
    name: 'Any',
    id: 'A',
    type,
    format: readDocumentText(`{\\rtf1${FONTS}${text}}`),
  });
  const plain = { bold: false, italic: false, monospace: false };

  it('reads bold and italic from what the sample sets', () => {
    expect(styleLook(styled('Char', String.raw`\f0\b Attributes`))).toEqual({
      ...plain,
      bold: true,
    });
    expect(styleLook(styled('Char', String.raw`\f0\i Attributes`))).toEqual({
      ...plain,
      italic: true,
    });
  });

  it("reads them from the sample's font, as a new project's styles name a face", () => {
    expect(styleLook(styled('Char', String.raw`\f1 Attributes`))).toEqual({ ...plain, bold: true });
    expect(styleLook(styled('Char', String.raw`\f2 Attributes`))).toEqual({
      ...plain,
      italic: true,
    });
    expect(styleLook(styled('Para+Char', String.raw`\f3 Attributes`))).toEqual({
      ...plain,
      monospace: true,
    });
  });

  it('finds nothing in plain text, a run with no font, or a paragraph style', () => {
    expect(styleLook(styled('Char', String.raw`\f0 Attributes`))).toEqual(plain);
    expect(styleLook(styled('Char', 'Attributes'))).toEqual(plain);
    expect(styleLook(styled('Para', String.raw`\f1\i Attributes`))).toEqual(plain);
  });
});
