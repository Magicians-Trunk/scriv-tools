import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCommand, type CommandDef } from 'citty';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { STYLES, writeFixture } from '../test/fixture.ts';
import { PARA } from '../test/rtf-builder.ts';
import { projectDocuments } from './document.ts';
import { readParagraphs } from './edit-pieces.ts';
import { findItem, indexBinder, openProject } from './project.ts';
import type { StructureItem } from './structure.ts';

const run = vi.hoisted(() => ({ command: undefined as CommandDef | undefined }));

vi.mock('citty', async (original) => ({
  ...(await original<typeof import('citty')>()),
  runMain: (command: CommandDef) => {
    run.command = command;
  },
}));

let project: string;

beforeAll(async () => {
  await import('./cli.ts');
  project = writeFixture({ items: [{ id: 'A', title: 'A', text: 'Hello' }] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const stderr = async (...rawArgs: string[]) => {
  const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  await runCommand(run.command!, { rawArgs });
  const written = write.mock.calls.map(([chunk]) => String(chunk)).join('');
  write.mockRestore();
  out.mockRestore();
  return written;
};

describe('new', () => {
  it('creates a project in a folder, which the rest of the commands can read', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-cli-new-'));
    const made = (await stdout('new', 'Fresh', '--folder', folder)).trim();
    expect(made).toBe(path.join(folder, 'Fresh.scriv'));
    expect(await stdout('compile', made)).toContain('Title: Fresh');
  });

  it('creates it here when told no folder', async () => {
    const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-cli-here-')));
    vi.spyOn(process, 'cwd').mockReturnValue(folder);
    const made = (await stdout('new', 'Here')).trim();
    vi.restoreAllMocks();
    expect(made).toBe(path.join(folder, 'Here.scriv'));
  });
});

const stdout = async (...rawArgs: string[]) => {
  const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await runCommand(run.command!, { rawArgs });
  const written = write.mock.calls.map(([chunk]) => String(chunk)).join('');
  write.mockRestore();
  return written;
};

/** A path to export to, with no extension. */
const OUT = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-cli-')), 'out');

/** A project to edit. */
const editing = () =>
  writeFixture({
    items: [
      { id: 'A', title: 'A', text: `one${PARA}two`, custom: { place: 'sea' } },
      { id: 'B', title: 'B', text: 'other', custom: { place: 'sea' } },
      { id: 'F', title: 'F', type: 'Folder' },
    ],
    topLevel: [{ id: 'T', title: 'Trash', type: 'TrashFolder' }],
    scrivx: (scrivx) => {
      scrivx.customFields.push({ id: 'place', type: 'Text', title: 'Place' });
    },
  });
const compiled = (dir: string) => stdout('compile', dir, '--quiet-placeholders');

describe('scriv-tools', () => {
  it('compiles to stdout, or to a file', async () => {
    expect(await stdout('compile', project, '--author', 'Ada')).toContain(
      '::: {file=""}\n\nHello\n\n:::',
    );
    const output = path.join(project, '..', 'out.md');
    expect(await stdout('compile', project, '--format=Fixture Format', '-o', output)).toBe('');
    expect(fs.readFileSync(output, 'utf8')).toContain('Hello');
  });

  it('lists what it leaves as written unless told to keep quiet', async () => {
    const tagged = writeFixture({
      items: [{ id: 'B', title: 'B', text: '<$nope> <$nope> x<!$Scr_Cs::0>' }],
      compile: ({ projectSettings }) => {
        projectSettings.metadata.mmd[1]!.value = '<$alsoNope>';
      },
    });
    expect(await stderr('compile', tagged, '--author', 'Ada')).toBe(
      'Left as written, as Scrivener does: <!$Scr_Cs::0> in "B"\n' +
        'Left as written, as Scrivener does: <$alsoNope>\n' +
        'Left as written, as Scrivener does: <$nope> in "B"\n',
    );
    expect(await stderr('compile', tagged, '--quiet-placeholders')).toBe('');
    expect(await stderr('read', tagged, 'B')).toBe(
      'Left as written, as Scrivener does: <!$Scr_Cs::0> in "B"\n' +
        'Left as written, as Scrivener does: <$nope> in "B"\n',
    );
    expect(await stderr('read', tagged, 'B', '--quiet-placeholders')).toBe('');
  });

  it('reads one document', async () => {
    expect(await stdout('read', project, 'A')).toBe('Hello');
  });

  it('prints the binder as JSON', async () => {
    const structure: StructureItem[] = JSON.parse(await stdout('structure', project));
    const [draft] = structure;
    expect(draft?.children.map((item) => item.title)).toEqual(['A']);
  });

  it('lists the compile formats it finds', async () => {
    vi.stubEnv('SCRIVENER_APP', '/nowhere');
    expect(await stdout('formats', project)).toBe(
      `Fixture Format\tproject\t${path.join(project, 'Settings', 'Compile Formats', 'Fixture-Format.scrformat')}\n`,
    );
  });

  describe('editing', () => {
    it('finds items, with their binder paths', async () => {
      const dir = editing();
      expect(await stdout('find', dir, 'field:place=sea')).toBe('A\tDraft/A\tA\nB\tDraft/B\tB\n');
    });

    it('stops on a selector that names nothing', async () => {
      await expect(stdout('find', editing(), 'id:Z')).rejects.toThrow('Nothing matches');
    });

    it('exports both forms, and takes an edited Markdown file back', async () => {
      const dir = editing();
      const out = OUT();
      await stdout('export', dir, 'id:A', '--output', out);
      const edited = fs.readFileSync(`${out}.md`, 'utf8').replace('two', 'second');
      expect(JSON.parse(fs.readFileSync(`${out}.json`, 'utf8'))[0].item).toBe('A');
      fs.writeFileSync(`${out}.md`, edited);
      expect(await stdout('import', dir, 'id:A', `${out}.md`)).toContain('content.rtf');
      expect(await compiled(dir)).toContain('one\nsecond');
    });

    it("shows each item's compiled text, with the format and author it is given", async () => {
      const dir = editing();
      const out = OUT();
      await stdout(
        'export',
        dir,
        'id:A',
        '--output',
        out,
        '--author',
        'Ann',
        '--format',
        'Fixture Format',
      );
      const [document] = JSON.parse(fs.readFileSync(`${out}.json`, 'utf8'));
      expect(document.compiled.pieces.join('')).toContain('one\ntwo');
      expect(fs.readFileSync(`${out}.md`, 'utf8')).toContain('<!-- end of compiled A -->');
    });

    it('refuses an item whose compiled text changed, saving the rest, and fails', async () => {
      const dir = editing();
      const out = OUT();
      await stdout('export', dir, 'path:Draft', '--output', out);
      const exported = fs.readFileSync(`${out}.md`, 'utf8');
      const edited = exported
        .replace('two', 'second')
        .replace('one\ntwo', 'one\nchanged')
        .replace('other', 'another');
      fs.writeFileSync(`${out}.md`, edited);
      expect(await stderr('import', dir, 'path:Draft', `${out}.md`)).toContain(
        'Refused A, so nothing was written for it',
      );
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      const compile = await compiled(dir);
      expect(compile).toContain('one\ntwo');
      expect(compile).toContain('another');
    });

    it('takes an edited structured file back', async () => {
      const dir = editing();
      const out = OUT();
      await stdout('export', dir, 'id:A', '--output', out);
      const [document] = JSON.parse(fs.readFileSync(`${out}.json`, 'utf8'));
      document.paragraphs[1].text = [{ text: 'second' }];
      fs.writeFileSync(`${out}.json`, JSON.stringify([document]));
      await stdout('import', dir, 'id:A', `${out}.json`);
      expect(await compiled(dir)).toContain('one\nsecond');
    });

    it('exports and imports a part of a document', async () => {
      const dir = editing();
      const out = OUT();
      await stdout('export', dir, 'id:A', 'text:two', '--output', out);
      const part = fs.readFileSync(`${out}.md`, 'utf8');
      expect(part).toMatch(/^<!-- item A -->\n\ntwo\n\n<!-- compiled A /);
      fs.writeFileSync(`${out}.md`, part.replace('two', 'second'));
      await stdout('import', dir, 'id:A', 'text:two', `${out}.md`);
      expect(await compiled(dir)).toContain('one\nsecond');
    });

    it('exports and imports by the stylesheet, whatever the format maps headings and code to', async () => {
      const text = `<$Scr_H::1><$Scr_Ps::0>Top${PARA}<!$Scr_H::1><!$Scr_Ps::0>two`;
      const items = [{ id: 'A', title: 'A', text, styles: [STYLES.heading] }];
      const plain = writeFixture({ items });
      const demoted = writeFixture({
        items,
        format: (format) => {
          for (const style of format.styles ?? []) {
            if (style.name === 'Heading 1') style.prefix = '## ';
          }
          Object.assign(format.mmd ?? {}, {
            codeSpanId: 'F-MARKED',
            blockQuoteStyleId: 'F-MARKED',
          });
        },
      });
      const exported = async (dir: string) => {
        const out = OUT();
        await stdout('export', dir, 'id:A', '--output', out);
        const [markdown = ''] = fs.readFileSync(`${out}.md`, 'utf8').split('<!-- compiled');
        return { out, markdown };
      };
      expect(await compiled(demoted)).toContain('## Top');
      const one = await exported(plain);
      const other = await exported(demoted);
      expect(other.markdown.replaceAll(other.out, one.out)).toBe(one.markdown);
      expect(other.markdown).toContain('# Top');
      const edited = fs
        .readFileSync(`${other.out}.md`, 'utf8')
        .replace('two', 'two\n\n> said `code`');
      fs.writeFileSync(`${other.out}.md`, edited);
      await stdout('import', demoted, 'id:A', `${other.out}.md`);
      const read = readParagraphs(openProject(demoted), projectDocuments(demoted).text('A'));
      expect(read.map(({ style }) => style)).toEqual(['Heading 1', undefined, 'Block Quote']);
      expect(read.at(-1)?.text.at(-1)).toMatchObject({ style: 'Code Span' });
    });

    it("takes a mapping for a role, in place of Scrivener's name for it", async () => {
      const dir = editing();
      const out = OUT();
      const file = `${out}.mapping.json`;
      fs.writeFileSync(file, JSON.stringify({ quote: 'Heading 1' }));
      await stdout('export', dir, 'id:A', '--output', out, '--mapping', file);
      const exported = fs.readFileSync(`${out}.md`, 'utf8');
      fs.writeFileSync(`${out}.md`, exported.replace('two', 'two\n\n> Deep'));
      await stdout('import', dir, 'id:A', `${out}.md`, '--mapping', file);
      expect(await compiled(dir)).toContain('# Deep');
    });

    it('writes nothing when a change cannot be made, and says why', async () => {
      const dir = editing();
      const out = OUT();
      await stdout('export', dir, 'id:A', '--output', out);
      const edited = fs.readFileSync(`${out}.md`, 'utf8').replaceAll(' A ', ' Z ');
      fs.writeFileSync(`${out}.md`, edited.replace('two', 'second'));
      await expect(stdout('import', dir, 'id:A', `${out}.md`)).rejects.toThrow('not read: Z');
      expect(await compiled(dir)).toContain('one\ntwo');
    });

    it('adds, moves and trashes', async () => {
      const dir = editing();
      const id = (await stdout('add', dir, 'id:F', '--title', 'New')).trim().split('\n').at(-1)!;
      await stdout('add', dir, 'id:F', '--folder', '--title', 'Sub', '--index', '0');
      await stdout('move', dir, 'id:B', '--to', 'id:F');
      await stdout('trash', dir, `id:${id}`);
      const items: StructureItem[] = JSON.parse(await stdout('structure', dir));
      const [draft, trash] = items;
      const folder = draft!.children.find(({ id: each }) => each === 'F');
      expect(folder?.children.map(({ title }) => title)).toEqual(['Sub', 'B']);
      expect(trash?.children.map(({ title }) => title)).toEqual(['New']);
    });

    it('sets and clears a field, and finds by it', async () => {
      const dir = editing();
      await stdout('set', dir, 'id:A', '--field', 'place', '--value', 'land');
      await stdout('set', dir, 'id:B', '--field', 'place');
      expect(await stdout('find', dir, 'field:place=land')).toContain('A\t');
    });

    it('stops on more than one item', async () => {
      const dir = editing();
      await expect(stdout('trash', dir, 'field:place=sea')).rejects.toThrow('more than one');
    });

    it('changes all of an item, and only what it is given', async () => {
      const dir = editing();
      await stdout(
        'set',
        dir,
        'id:A',
        '--title',
        'Renamed',
        '--synopsis',
        'short',
        '--notes',
        'noted',
        '--label',
        'Blue',
        '--status',
        'Done',
        '--section',
        'Heading',
        '--compile',
        'no',
      );
      const item = findItem(indexBinder(openProject(dir).binder), 'A');
      expect(item).toMatchObject({ title: 'Renamed', metadata: { labelId: '1', statusId: '2' } });
      expect(item.metadata?.includeInCompile).toBe(false);
      const documents = projectDocuments(dir);
      expect(documents.synopsis('A')).toBe('short');
      expect(documents.text('A', 'notes').paragraphs).toHaveLength(1);
      await stdout('set', dir, 'id:A', '--compile', 'yes');
      expect(findItem(indexBinder(openProject(dir).binder), 'A').title).toBe('Renamed');
      await expect(stdout('set', dir, 'id:A', '--compile', 'maybe')).rejects.toThrow('yes or no');
    });

    it("exports the documents' own text, whatever stops the compile", async () => {
      const dir = writeFixture({
        items: [{ id: 'A', title: 'A', text: 'one' }],
        format: (format) => {
          format.postProcessing = { enabled: true };
        },
      });
      const out = OUT();
      expect(await stderr('export', dir, 'id:A', '--output', out)).toContain(
        'No item shows its compiled text: Unsupported',
      );
      expect(fs.readFileSync(`${out}.md`, 'utf8')).toBe(
        '<!-- item A -->\n\none\n\n<!-- compiled A: none, as the compile stops -->\n',
      );
    });

    it('writes images beside a compile, and says when it has nowhere to', async () => {
      const image = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-cli-')), 'shot.png');
      fs.writeFileSync(image, 'bytes');
      const text = `\\{$SCRImageLink[w:1;h:1]=${image}\\}`;
      const dir = writeFixture({ items: [{ id: 'A', title: 'A', text }] });
      const out = `${OUT()}.md`;
      await stdout('compile', dir, '--quiet-placeholders', '--output', out);
      expect(fs.readFileSync(path.join(path.dirname(out), 'shot.png'), 'utf8')).toBe('bytes');
      const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      await stdout('compile', dir, '--quiet-placeholders');
      expect(String(write.mock.calls[0]?.[0])).toContain('--output');
      write.mockRestore();
    });

    it('takes Markdown in, shows the other files, and takes snapshots', async () => {
      const dir = editing();
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'scriv-cli-'));
      fs.writeFileSync(path.join(folder, 'New.md'), 'ingested\n');
      await stdout('ingest', dir, 'id:F', folder);
      expect(await compiled(dir)).toContain('ingested');
      fs.writeFileSync(path.join(folder, 'New.md'), '***\n');
      await expect(stdout('ingest', dir, 'id:F', folder)).rejects.toThrow('has no place');
      fs.writeFileSync(path.join(dir, 'Files', 'version.txt'), '23');
      fs.writeFileSync(path.join(dir, 'Files', 'Data', 'docs.checksum'), 'a/content.rtf=1');
      const files: unknown = JSON.parse(await stdout('files', dir));
      expect(files).toMatchObject({ version: 23 });
      expect(await stdout('files', dir)).toContain('a/content.rtf');
      const taken: unknown = JSON.parse(await stdout('snapshots', dir, 'id:A', '--take', 'Before'));
      expect(taken).toMatchObject([{ title: 'Before' }]);
      expect(await stdout('snapshots', dir, 'id:A')).toContain('Before');
    });

    it('passes on what a save warns of', async () => {
      const dir = editing();
      fs.writeFileSync(path.join(dir, 'Files', 'user.lock'), '');
      expect(await stderr('trash', dir, 'id:B')).toContain('may have the project open');
    });
  });
});
