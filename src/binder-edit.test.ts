import { describe, expect, it } from 'vite-plus/test';
import { writeFixture } from '../test/fixture.ts';
import {
  addItem,
  type BinderZone,
  canDrop,
  moveItem,
  readNotes,
  replaceNotes,
  setCustomField,
  setItem,
  addTopItem,
  trashItem,
} from './binder-edit.ts';
import { projectDocuments } from './document.ts';
import { EditError, type Inline, readParagraphs } from './edit-pieces.ts';
import { same } from './rich-text.ts';
import { findItem, indexBinder, openProject } from './project.ts';
import { saveProject } from './save.ts';

function opened() {
  const dir = writeFixture({
    items: [
      { id: 'F', title: 'Folder', type: 'Folder', children: [{ id: 'A', title: 'A' }] },
      { id: 'B', title: 'B' },
    ],
    topLevel: [{ id: 'T', title: 'Trash', type: 'TrashFolder' }],
  });
  const project = openProject(dir);
  const item = (id: string) => findItem(indexBinder(project.binder), id);
  return { dir, project, item };
}

const titles = (children: { title?: string }[]) => children.map(({ title }) => title);

describe('addItem', () => {
  it('adds at a place, or last, and saves', () => {
    const { dir, project, item } = opened();
    const first = addItem('Text', 'First', { parent: item('F'), index: 0 });
    addItem('Folder', 'Last', { parent: item('F') });
    expect(titles(item('F').children)).toEqual(['First', 'A', 'Last']);
    saveProject(project);
    expect(findItem(indexBinder(openProject(dir).binder), first.id).type).toBe('Text');
  });

  it('stops on a place that is not there', () => {
    const { item } = opened();
    expect(() => addItem('Text', 'X', { parent: item('F'), index: 5 })).toThrow(EditError);
    expect(() => addItem('Text', 'X', { parent: item('F'), index: -1 })).toThrow('no place -1');
  });
});

describe('moveItem', () => {
  it('moves an item with what is under it', () => {
    const { project, item } = opened();
    moveItem(project, item('F'), { parent: item('B') });
    expect(titles(item('B').children)).toEqual(['Folder']);
    expect(titles(item('F').children)).toEqual(['A']);
  });

  it('stops on moving an item inside itself, or a top folder', () => {
    const { project, item } = opened();
    expect(() => moveItem(project, item('F'), { parent: item('A') })).toThrow('inside itself');
    expect(() => moveItem(project, project.binder[0]!, { parent: item('T') })).toThrow(
      'cannot be moved',
    );
  });
});

describe('canDrop', () => {
  it('takes what the move takes', () => {
    const { project, item } = opened();
    expect(canDrop(project.binder, item('A'), item('F'), 'into')).toBe(true);
    expect(canDrop(project.binder, item('F'), item('B'), 'before')).toBe(true);
  });

  it('refuses itself, what is under it, and a top folder', () => {
    const { project, item } = opened();
    const zones: BinderZone[] = ['before', 'after', 'into'];
    for (const zone of zones) {
      expect(canDrop(project.binder, item('F'), item('F'), zone)).toBe(false);
    }
    expect(canDrop(project.binder, item('F'), item('A'), 'into')).toBe(false);
    expect(canDrop(project.binder, item('F'), item('A'), 'after')).toBe(false);
    expect(canDrop(project.binder, project.binder[0]!, item('T'), 'into')).toBe(false);
  });

  it('puts nothing beside what sits at the top', () => {
    const { project, item } = opened();
    expect(canDrop(project.binder, item('F'), project.binder[0]!, 'before')).toBe(false);
    expect(canDrop(project.binder, item('F'), project.binder[0]!, 'into')).toBe(true);
  });
});

describe('addTopItem', () => {
  it('adds a text above the Draft, which can then move and go to the Trash', () => {
    const { project } = opened();
    const item = addTopItem(project, 'About');
    expect(project.binder[0]).toBe(item);
    expect(item).toMatchObject({ type: 'Text', title: 'About' });
    trashItem(project, item);
    expect(project.binder).not.toContain(item);
    expect(project.binder.at(-1)!.children).toContain(item);
  });
});

describe('trashItem', () => {
  it('moves the item to the Trash', () => {
    const { project, item } = opened();
    trashItem(project, item('A'));
    expect(titles(item('T').children)).toEqual(['A']);
    expect(item('F').children).toEqual([]);
  });

  it('stops when the project has no Trash', () => {
    const dir = writeFixture({ items: [{ id: 'A', title: 'A' }] });
    const project = openProject(dir);
    expect(() => trashItem(project, project.binder[0]!.children[0]!)).toThrow('no Trash');
  });
});

describe('setCustomField', () => {
  it('sets and clears a field the project has', () => {
    const { project, item } = opened();
    project.customFields.push({ id: 'place', type: 'Text', title: 'Place' });
    setCustomField(project, item('A'), 'place', 'sea');
    expect(item('A').metadata?.custom).toEqual({ place: 'sea' });
    setCustomField(project, item('A'), 'place', undefined);
    expect(item('A').metadata?.custom).toEqual({});
  });

  it('stops on a field the project does not have', () => {
    const { project, item } = opened();
    expect(() => setCustomField(project, item('A'), 'nope', 'x')).toThrow('no custom field');
  });
});

describe('setItem', () => {
  it('changes an item by name, and saves', () => {
    const { dir, project, item } = opened();
    const change = {
      title: 'New',
      label: 'Blue',
      status: 'Done',
      section: 'Heading',
      include: false,
    };
    setItem(project, item('B'), change);
    saveProject(project);
    const saved = findItem(indexBinder(openProject(dir).binder), 'B');
    expect(saved.title).toBe('New');
    expect(saved.metadata).toMatchObject({
      labelId: '1',
      statusId: '2',
      sectionType: { id: 'T-HEADING' },
      includeInCompile: false,
    });
  });

  it('clears a label, status and section, and leaves what is not given', () => {
    const { project, item } = opened();
    setItem(project, item('B'), { label: 'Blue', status: 'Done', section: 'Heading' });
    setItem(project, item('B'), { label: '', status: '', section: '' });
    expect(item('B').title).toBe('B');
    expect(item('B').metadata?.labelId).toBeUndefined();
    expect(item('B').metadata?.statusId).toBeUndefined();
    expect(item('B').metadata?.sectionType?.id).toBe('');
  });

  it('stops on a name the project does not have', () => {
    const { project, item } = opened();
    expect(() => setItem(project, item('B'), { label: 'Red' })).toThrow('no label "Red"');
    expect(() => setItem(project, item('B'), { status: 'Red' })).toThrow('no status');
    expect(() => setItem(project, item('B'), { section: 'Red' })).toThrow('no section type');
  });
});

/** Pieces with the same look as one, however the RTF splits them. */
const joined = (text: Inline[]) =>
  text.reduce((all: Inline[], piece) => {
    const last = all.at(-1);
    if (last && !last.note && same({ ...last, text: '' }, { ...piece, text: '' })) {
      last.text += piece.text;
    } else all.push({ ...piece });
    return all;
  }, []);

describe('replaceNotes', () => {
  it('takes no list from the plain text nearest it', () => {
    const list = String.raw`{\*\listtable{\list\listhybrid{\listlevel\levelnfc23{\leveltext\'01\uc0\u8226 ;}{\levelnumbers;}}\listid1}}{\*\listoverridetable{\listoverride\listid1\listoverridecount0\ls1}}\ls1\ilvl0 {\listtext \uc0\u8226 }item`;
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', text: list }] });
    const project = openProject(dir);
    const item = findItem(indexBinder(project.binder), 'A');
    const notes = replaceNotes(project, projectDocuments(dir), item, 'plain');
    expect(notes.paragraphs[0]?.format.list).toBeUndefined();
  });

  it('keeps the formatting of what the lines leave alone', () => {
    const notes = String.raw`{\b Bold} words and {\field{\*\fldinst{HYPERLINK "https://example.com"}}{\fldrslt a link}}\
{\i kept}`;
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', notes }] });
    const project = openProject(dir);
    const documents = projectDocuments(dir);
    const item = findItem(indexBinder(project.binder), 'A');
    const changed = replaceNotes(
      project,
      documents,
      item,
      'Bold words, and a link here\nkept\nnew',
    );
    const read = readParagraphs(project, changed).map(({ text }) => joined(text));
    expect(read).toEqual([
      [
        { text: 'Bold', bold: true },
        { text: ' words, and ' },
        { text: 'a link', link: { kind: 'address', address: 'https://example.com' } },
        { text: ' here' },
      ],
      [{ text: 'kept', italic: true }],
      [{ text: 'new', italic: true }],
    ]);
    const again = replaceNotes(
      project,
      projectDocuments(dir),
      item,
      readNotes(project, documents, 'A'),
    );
    expect(again.source).toBe(documents.text('A', 'notes').source);
  });

  it('keeps a note where it was, and types at the start in the look after it', () => {
    const notes = String.raw`{\b one}\{\\Scrv_fn=note\\end_Scrv_fn\} two`;
    const dir = writeFixture({ items: [{ id: 'A', title: 'A', notes }] });
    const project = openProject(dir);
    const documents = projectDocuments(dir);
    const item = findItem(indexBinder(project.binder), 'A');
    const before = readParagraphs(project, documents.text('A', 'notes'));
    const changed = replaceNotes(project, documents, item, 'so one two');
    const read = joined(readParagraphs(project, changed)[0]!.text);
    expect(read[0]).toEqual({ text: 'so one', bold: true });
    expect(read.slice(1, -1)).toEqual(before[0]!.text.slice(1, -1));
    expect(read.at(-1)).toEqual({ text: ' two' });
  });

  it("writes an item's notes, a paragraph to a line, and clears them", () => {
    const { dir, project, item } = opened();
    const documents = projectDocuments(dir);
    const notes = replaceNotes(project, documents, item('B'), 'one\ntwo');
    saveProject(project, { documents: new Map([['B', { notes }]]) });
    expect(documents.text('B', 'notes').paragraphs).toHaveLength(2);
    const cleared = replaceNotes(project, documents, item('B'), '');
    expect(cleared.paragraphs).toHaveLength(0);
  });
});
