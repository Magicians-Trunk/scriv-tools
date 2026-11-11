import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import {
  BoundText,
  compileModel,
  findItem,
  flatten,
  indexBinder,
  styleName,
  openProject,
  prepareCompile,
  readModel,
  writeCompile,
  type BinderItem,
} from './index.ts';

const BASIC = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'basic.scriv');
const GOLDEN = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'test', 'fixtures', 'basic.md'),
  'utf8',
);
const NOW = { now: new Date(2026, 9, 31, 12) };

const titled = (items: BinderItem[], title: string) =>
  flatten(items).find((item) => item.title === title)!;

describe('the library', () => {
  it('reads a project into a model that compiles as Scrivener compiled it', () => {
    expect(compileModel(readModel(BASIC), NOW)).toBe(GOLDEN);
    expect(compileModel(readModel(openProject(BASIC)), NOW)).toBe(GOLDEN);
  });

  it('compiles a changed model as Scrivener would compile the changed project', () => {
    const model = readModel(BASIC);
    const chapter = titled(model.project.binder, 'Chapter One');
    // Indexed before the change, which the compile must not rely on.
    expect(findItem(indexBinder(model.project.binder), chapter.id)).toBe(chapter);
    chapter.title = 'Chapter Uno';
    // The edited document is held in memory; the rest still come from the project's files.
    const files = model.documents;
    const edited = {
      ...files.text(chapter.id),
      paragraphs: [
        {
          content: [{ kind: 'text' as const, text: 'Edited text.', format: {} }],
          format: {},
          end: { kind: 'document' as const, format: {} },
        },
      ],
    };
    model.documents = {
      ...files,
      text: (id, part) => (id === chapter.id && part !== 'notes' ? edited : files.text(id, part)),
    };
    const output = compileModel(model, NOW);
    expect(output).toContain('## Chapter Uno ##\n\nEdited text.\n\n');
    expect(output).not.toContain('with two  spaces');
  });

  it('prepares a compile to read or change before writing it', () => {
    const model = readModel(BASIC);
    const prepared = prepareCompile(model, NOW);
    expect(writeCompile(prepared)).toBe(GOLDEN);
    const section = prepared.sections.find(({ item }) => item.title === 'Chapter One')!;
    expect(section.level).toBe(2);
    section.text = BoundText.join([section.text, '\n\nAdded.']);
    expect(writeCompile(prepared)).toContain('Second paragraph.\n\nAdded.');
  });

  it("reads a document's markup as a tree, its style markers numbering its styles", () => {
    const model = readModel(BASIC);
    const untitled = flatten(model.project.binder).find(
      (item) => item.title === undefined && item.type === 'Text',
    )!;
    const document = model.documents.text(untitled.id);
    expect(styleName(model.project, document.styleIds[0])).toBe('Code Span');
    const [, run] = document.paragraphs;
    // The nodes, their formatting aside.
    const bare = run!.content.map((node) => {
      const { format: _, ...rest } = node as typeof node & { format?: unknown };
      return rest;
    });
    expect(bare).toEqual([
      { kind: 'text', text: 'Run ' },
      {
        kind: 'style',
        scope: 'character',
        index: 0,
        closing: false,
        source: '<$Scr_Cs::0>',
      },
      { kind: 'text', text: 'make check' },
      {
        kind: 'style',
        scope: 'character',
        index: 0,
        closing: true,
        source: '<!$Scr_Cs::0>',
      },
      { kind: 'text', text: ' now.' },
    ]);
  });
});
