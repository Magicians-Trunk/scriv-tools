import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { compileModel } from './compile.ts';
import { openProject } from './project.ts';
import { compiledChange, compiledText, itemCompiles, sealOf } from './item-compile.ts';
import { readModel } from './model.ts';

const NOTE = 'one\\{\\\\Scrv_fn= a note \\\\end_Scrv_fn\\}';

/** A project whose compile writes footnotes. */
const withNotes = (items: Parameters<typeof writeFixture>[0]['items']) =>
  writeFixture({
    items,
    compile: ({ projectSettings }) => {
      delete projectSettings.options.removeFootnotes;
    },
  });

describe('item compiles', () => {
  it("cuts each item's text from the compile: its section, its footnotes and its metadata", () => {
    const dir = withNotes([
      { id: 'M', title: 'Meta-data', text: 'Key: value' },
      { id: 'A', title: 'A', text: NOTE },
      { id: 'E', title: 'E', text: '' },
    ]);
    const compiles = itemCompiles(openProject(dir));
    const whole = compileModel(readModel(dir));
    expect(compiledText(compiles, 'M')).toMatchObject({ pieces: ['Key: value'] });
    const pieces = ['::: {file=""}\n\none[^cf1]\n\n:::', '[^cf1]: a note'];
    expect(compiledText(compiles, 'A')).toMatchObject({ pieces });
    for (const piece of pieces) expect(whole).toContain(piece);
    expect(compiledText(compiles, 'E')).toMatchObject({ pieces: ['::: {file=""}\n\n\n\n:::'] });
  });

  it('seals the pieces, and says when an item is left out or the compile stops', () => {
    const dir = writeFixture({ items: [{ id: 'X', title: 'X', text: 'x', include: false }] });
    const compiles = { pieces: new Map([['A', ['a']]]) };
    expect(compiledText(compiles, 'A')).toEqual({
      kind: 'text',
      pieces: ['a'],
      seal: sealOf(['a']),
    });
    expect(compiledText(itemCompiles(openProject(dir)), 'X')).toEqual({ kind: 'left out' });
    expect(compiledText({ stopped: 'why' }, 'A')).toEqual({ kind: 'stopped' });
    expect(sealOf(['a'])).not.toBe(sealOf(['a ']));
  });

  it('says what stops the compile, and throws anything else', () => {
    const project = openProject(writeFixture({ items: [{ id: 'A', title: 'A', text: 'x' }] }));
    expect(itemCompiles(project, 'No Such Format')).toMatchObject({
      stopped: expect.stringContaining('No Such Format'),
    });
    Object.defineProperty(project, 'compileSettings', {
      get() {
        throw 'not an error';
      },
    });
    expect(itemCompiles(project)).toEqual({ stopped: 'not an error' });
    const posted = writeFixture({
      items: [{ id: 'A', title: 'A', text: 'x' }],
      format: (format) => {
        format.postProcessing = { enabled: true };
      },
    });
    expect(itemCompiles(openProject(posted))).toMatchObject({
      stopped: expect.stringContaining('Unsupported'),
    });
    const grouped = writeFixture({
      items: [{ id: 'A', title: 'A', text: 'x' }],
      draftText: 'x',
      compile: (settings) => {
        settings.projectSettings.content.includeGroupText = true;
      },
    });
    expect(itemCompiles(openProject(grouped))).toEqual({
      stopped: 'Unsupported: compiling the text of the Draft folder itself',
    });
    const broken = writeFixture({ items: [{ id: 'A', title: 'A', text: 'x' }] });
    const rtf = path.join(broken, 'Files', 'Data', 'A', 'content.rtf');
    const opened = openProject(broken);
    fs.rmSync(rtf);
    fs.mkdirSync(rtf);
    expect(() => itemCompiles(opened)).toThrow('EISDIR');
  });

  it('says why compiled text cannot come back: none, or not as written', () => {
    expect(compiledChange(undefined)).toContain('no compiled text');
    expect(compiledChange({ kind: 'text', pieces: ['b'], seal: sealOf(['a']) })).toContain(
      'not as export wrote it',
    );
    expect(compiledChange({ kind: 'text', pieces: ['a'], seal: sealOf(['a']) })).toBeUndefined();
    expect(compiledChange({ kind: 'left out' })).toBeUndefined();
  });
});
