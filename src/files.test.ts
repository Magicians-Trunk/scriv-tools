import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { compileModel } from './compile.ts';
import { projectDocuments } from './document.ts';
import { insertParagraphs } from './edit.ts';
import { readForEditing } from './editable.ts';
import { hexBytes, hexOf, latin1Bytes, latin1Text, readText, textBytes } from './files.ts';
import { localFiles as browserFiles } from './local-files-browser.ts';
import { memoryFiles } from './memory-files.ts';
import { readModel } from './model.ts';
import { openProject } from './project.ts';
import { saveProject } from './save.ts';

/** Every file under a folder, by its path. */
function everyFile(dir: string): [string, Uint8Array][] {
  const entries = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' });
  return entries
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile())
    .map((file) => [file, fs.readFileSync(file)]);
}

const files = () => memoryFiles([['/p/a/one.txt', textBytes('one')]]);
const fixture = () => writeFixture({ items: [{ id: 'A', title: 'A', text: 'one' }] });

describe('Latin-1 and hexadecimal', () => {
  it('keeps every byte, which Windows-1252 would not', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, at) => at);
    expect(latin1Bytes(latin1Text(bytes))).toEqual(bytes);
    expect(latin1Text(Uint8Array.of(0x80))).toBe('\u0080');
    expect(latin1Text(Uint8Array.of(0x41, 0xa0, 0xe9, 0xff))).toBe('A\u00a0\u00e9\u00ff');
  });

  it('reads more than one chunk', () => {
    expect(latin1Text(new Uint8Array(20_000).fill(0x85))).toBe('\u0085'.repeat(20_000));
  });

  it('writes hexadecimal both ways', () => {
    expect(hexOf(Uint8Array.of(0, 15, 255))).toBe('000fff');
    expect(hexBytes('000fff')).toEqual(Uint8Array.of(0, 15, 255));
  });
});

describe('memoryFiles', () => {
  it('reads files, and folders from the paths inside them', () => {
    const held = files();
    expect(readText(held, '/p/a/one.txt')).toBe('one');
    expect(held.exists('/p/a')).toBe(true);
    expect(held.exists('/p/b')).toBe(false);
    expect(held.isDirectory('/p/a')).toBe(true);
    expect(held.isDirectory('/p/a/one.txt')).toBe(false);
    expect(held.list('/p')).toEqual(['a']);
    expect(() => held.read('/p/none')).toThrow('No such file: /p/none');
  });

  it('keeps what changed until it is taken, the last change winning', () => {
    const held = files();
    held.write('/p/two.txt', textBytes('two'));
    held.remove('/p/a/one.txt');
    held.remove('/p/none');
    held.write('/p/three.txt', textBytes('three'));
    held.remove('/p/three.txt');
    const { written, removed } = held.takeChanges();
    expect([...written.keys()]).toEqual(['/p/two.txt']);
    expect([...removed]).toEqual(['/p/a/one.txt', '/p/three.txt']);
    held.write('/p/a/one.txt', textBytes('back'));
    held.remove('/p/two.txt');
    const next = held.takeChanges();
    expect([...next.written.keys()]).toEqual(['/p/a/one.txt']);
    expect(held.takeChanges().written.size).toBe(0);
    expect(held.all().size).toBe(1);
  });

  it('writes back over what was removed', () => {
    const held = files();
    held.remove('/p/a/one.txt');
    held.write('/p/a/one.txt', textBytes('again'));
    expect([...held.takeChanges().removed]).toEqual([]);
  });
});

describe('a project in memory', () => {
  it('reads, compiles and saves as the same project on disk does', () => {
    const dir = fixture();
    const held = memoryFiles(everyFile(dir));
    const edit = (
      project: ReturnType<typeof openProject>,
      documents = projectDocuments(dir, project.files),
    ) => {
      const document = documents.text('A');
      insertParagraphs(project, document, 1, [{ text: 'two' }]);
      saveProject(project, { documents: new Map([['A', { content: document }]]) });
    };
    const inMemory = openProject(dir, held);
    edit(inMemory);
    expect(compileModel(readModel(openProject(dir, held)))).toContain('two');
    const written = [...held.takeChanges().written];
    expect(written.length).toBeGreaterThan(0);
    expect(
      fs.readFileSync(path.join(dir, 'Files', 'Data', 'A', 'content.rtf'), 'latin1'),
    ).not.toContain('two');
    edit(openProject(dir));
    const rtf = path.join(dir, 'Files', 'Data', 'A', 'content.rtf');
    expect(Buffer.from(new Map(written).get(rtf)!).equals(fs.readFileSync(rtf))).toBe(true);
  });
});

describe('editing a project already open', () => {
  it('reads it as it is, without opening it again', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: 'one' }] });
    const project = openProject(dir, memoryFiles(everyFile(dir)));
    expect(readForEditing(project).project).toBe(project);
  });
});

describe('a browser with no files given', () => {
  it('says so rather than reading nothing', () => {
    const message = 'A browser has no disk: open the project with its files.';
    expect(() => openProject('/p', browserFiles)).toThrow(message);
  });
});
