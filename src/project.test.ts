import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import { projectDocuments } from './document.ts';
import { unreadList } from './xml-codec.ts';
import { adaptiveTitle, findItem, indexBinder, openProject } from './project.ts';
import { projectStructure } from './structure.ts';

/** Opens a one-item project whose .scrivx file the edit changes. */
function odd(edit: (xml: string) => string) {
  const project = writeFixture({ items: [{ id: 'A', title: 'A' }] });
  const file = path.join(project, 'Fixture.scrivx');
  fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8')));
  return openProject(project);
}

describe('openProject', () => {
  it('opens a project from its .scriv folder or its .scrivx file', () => {
    const project = writeFixture({ items: [{ id: 'A', title: 'A' }] });
    expect(openProject(project).dir).toBe(project);
    expect(openProject(path.join(project, 'Fixture.scrivx')).dir).toBe(project);
  });

  it('stops when the project is missing or its .scrivx is ambiguous', () => {
    const project = writeFixture({ items: [] });
    expect(() => openProject(path.join(project, 'missing'))).toThrow('Project not found');
    fs.writeFileSync(path.join(project, 'Other.scrivx'), '');
    expect(() => openProject(project)).toThrow('Expected one .scrivx file');
  });

  it('reads what it does not know, and lists it', () => {
    const project = odd((xml) =>
      xml
        .replace('Type="Text" ', 'Type="WebArchive" ')
        .replace('Type="Checkbox"', 'Type="Number" Extra="No"')
        .replace('<Binder>', '<Binder><Unknown/>'),
    );
    expect(unreadList(project.unsupported.scrivx)).toEqual([
      'a Unknown element in Binder',
      'the binder item type WebArchive',
      'the Extra attribute of MetaDataField',
      'the custom field type Number',
    ]);
    expect(findItem(indexBinder(project.binder), 'A').type).toBe('Other');
  });

  it('reads a project with no styles file as having no styles', () => {
    const project = writeFixture({ items: [] });
    fs.rmSync(path.join(project, 'Files', 'styles.xml'));
    expect(openProject(project).styles).toEqual([]);
  });

  it('stops on an id that is not in the binder', () => {
    expect(() =>
      findItem(indexBinder(openProject(writeFixture({ items: [] })).binder), 'NOPE'),
    ).toThrow('No binder item with id NOPE');
  });
});

describe('adaptiveTitle', () => {
  it('uses the title, the synopsis, the text, then a placeholder name', () => {
    const project = openProject(
      writeFixture({
        items: [
          { id: 'T', title: 'Titled', synopsis: 'Ignored' },
          { id: 'S', synopsis: '\n  Summary line \nmore', text: 'Text' },
          { id: 'X', text: '\\\n<$Scr_Ps::0>  First text <!$Scr_Ps::0>\\\nSecond' },
          { id: 'F', type: 'Folder' },
          { id: 'D' },
        ],
      }),
    );
    const index = indexBinder(project.binder);
    const documents = projectDocuments(project.dir);
    const titles = ['T', 'S', 'X', 'F', 'D'].map((id) =>
      adaptiveTitle(findItem(index, id), documents),
    );
    expect(titles).toEqual([
      'Titled',
      'Summary line',
      'First text',
      'Untitled Folder',
      'Untitled Document',
    ]);
  });
});

describe('projectStructure', () => {
  it('reports the binder with titles, section types, labels, statuses and custom metadata by name', () => {
    const project = openProject(
      writeFixture({
        items: [
          {
            id: 'F',
            type: 'Folder',
            title: 'Part',
            label: '1',
            status: '2',
            children: [
              { id: 'U', text: 'Opening', label: '-1', custom: { targetfile: 'a.md', gone: 'x' } },
            ],
          },
        ],
        topLevel: [{ id: 'R', type: 'ResearchFolder', title: 'Research', include: false }],
        scrivx: (scrivx) => void (scrivx.sectionTypes.levels.folders = []),
      }),
    );
    expect(projectStructure(project, projectDocuments(project.dir))).toMatchObject([
      {
        id: 'DRAFT',
        type: 'DraftFolder',
        title: 'Draft',
        untitled: false,
        folder: true,
        movable: false,
        includeInCompile: true,
        custom: {},
        children: [
          {
            id: 'F',
            type: 'Folder',
            title: 'Part',
            untitled: false,
            includeInCompile: true,
            label: 'Blue',
            status: 'Done',
            custom: {},
            children: [
              {
                id: 'U',
                type: 'Text',
                title: 'Opening',
                untitled: true,
                includeInCompile: true,
                sectionType: 'Section',
                custom: { TargetFile: 'a.md', gone: 'x' },
                children: [],
              },
            ],
          },
        ],
      },
      {
        id: 'R',
        type: 'ResearchFolder',
        title: 'Research',
        untitled: false,
        includeInCompile: false,
        custom: {},
        children: [],
      },
    ]);
  });

  it('reports an item with no metadata as left out, and "No Status" as no status', () => {
    const project = openProject(
      writeFixture({
        items: [
          { id: 'A', title: 'A' },
          { id: 'B', title: 'B', status: '-1' },
        ],
        scrivx: (scrivx) => void delete scrivx.binder[0]!.children[0]!.metadata,
      }),
    );
    const [a, b] = projectStructure(project, projectDocuments(project.dir))[0]!.children;
    expect(a).toMatchObject({ includeInCompile: false, custom: {} });
    expect(a).not.toHaveProperty('label');
    expect(b).not.toHaveProperty('status');
  });
});
