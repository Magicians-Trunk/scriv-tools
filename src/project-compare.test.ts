import { describe, expect, it } from 'vite-plus/test';
import { STYLES, writeFixture } from '../test/fixture.ts';
import { addItem, moveItem, setItem, trashItem } from './binder-edit.ts';
import { newBinderItem } from './binder-item.ts';
import type { ProjectVersion } from './binder-compare.ts';
import { compileModel } from './compile.ts';
import { projectDocuments } from './document.ts';
import { flatten, openProject } from './project.ts';
import { compareProjects, type ProjectComparison, styleFace } from './project-compare.ts';
import { applyProjectEdits, projectEdits } from './project-edits.ts';
import { mergeProjects } from './project-merge.ts';
import { markupText } from './markup.ts';
import { readModel } from './model.ts';
import { type ItemDocumentsChange, saveProject } from './save.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STAMP = new Date(2030, 0, 1);

/** A folder project of three items: a fresh copy each call, under one identity of IDs. */
function template() {
  return writeFixture({
    scrivx: (scrivx) => void scrivx.binder.push({ ...newBinderItem('TrashFolder'), id: 'TRASH' }),
    items: [
      { id: 'A', title: 'A', text: 'first words here', styles: [STYLES.heading, STYLES.codeSpan] },
      { id: 'B', title: 'B', text: 'second words here', notes: 'a note here', synopsis: 'gist' },
      {
        id: 'C',
        title: 'C',
        text: 'third words here',
        children: [{ id: 'D', title: 'D', text: 'under' }],
      },
    ],
  });
}

const open = (dir: string): ProjectVersion => {
  const project = openProject(dir);
  return { project, documents: projectDocuments(project.dir) };
};

/** Two copies of the template: the second as `change` left it, saved. */
function versions(change: (now: ProjectVersion) => Parameters<typeof saveProject>[1] | void) {
  const was = template();
  const now = template();
  const held = open(now);
  const changes = change(held);
  saveProject(held.project, { ...changes, now: STAMP });
  return { was: open(was), now: open(now) };
}

const item = ({ project }: ProjectVersion, id: string) =>
  flatten(project.binder).find((each) => each.id === id)!;

/** A second format beside the project's own, as a copy of it under another name. */
function addFormat(dir: string): void {
  const folder = path.join(dir, 'Settings', 'Compile Formats');
  const [name] = fs.readdirSync(folder);
  const text = fs.readFileSync(path.join(folder, name!), 'utf8');
  const renamed = text.replace(/<CompileFormat Name="[^"]*"/, '<CompileFormat Name="Other"');
  fs.writeFileSync(path.join(folder, 'Other.scrformat'), renamed);
}

/** The project's own format with a layout renamed. */
function renameLayout(dir: string): void {
  const folder = path.join(dir, 'Settings', 'Compile Formats');
  const [name] = fs.readdirSync(folder);
  const file = path.join(folder, name!);
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace('<Layout Name="Heading"', '<Layout Name="Head"'));
}

const plain = () => writeFixture({ items: [{ id: 'A', title: 'A', text: 'words' }] });

const empty: ProjectComparison = {
  items: [],
  documents: [],
  synopses: [],
  styles: [],
  compile: [],
  formats: [],
  settings: [],
};

/** Makes the edits on `was`, saves, and says what still differs from `now`. */
function proved({ was, now }: { was: ProjectVersion; now: ProjectVersion }) {
  const changes = applyProjectEdits(was, projectEdits(was, now));
  saveProject(was.project, changes);
  return compareProjects(open(was.project.dir), now);
}

describe('comparing projects', () => {
  it('finds nothing in a project saved again, whatever its stamps say', () => {
    const pair = versions(({ project }) => {
      project.modId = 'OTHER';
      project.modified = '2030-01-01 00:00:00 -0500';
      item({ project, documents: projectDocuments(project.dir) }, 'A').textSettings = {
        textSelection: [5, 5],
      };
    });
    expect(compareProjects(pair.was, pair.now)).toEqual(empty);
    expect(projectEdits(pair.was, pair.now)).toEqual([]);
  });

  it('says items were added, moved, trashed, renamed and reordered, with their paths', () => {
    const pair = versions((now) => {
      const { project } = now;
      const draft = project.binder[0]!;
      addItem('Text', 'New', { parent: draft, index: 0 });
      moveItem(project, item(now, 'D'), { parent: item(now, 'A') });
      setItem(project, item(now, 'A'), { title: 'Renamed' });
      trashItem(project, item(now, 'B'));
    });
    const { items } = compareProjects(pair.was, pair.now);
    expect(items.map(({ kind }) => kind).toSorted()).toEqual([
      'added',
      'moved',
      'moved',
      'renamed',
    ]);
    const moved = items.filter((each) => each.kind === 'moved');
    expect(moved.find(({ id }) => id === 'B')).toMatchObject({ trashed: true });
    expect(moved.find(({ id }) => id === 'D')).toMatchObject({
      trashed: false,
      from: [pair.was.project.binder[0]!.title, 'C'],
      to: [pair.was.project.binder[0]!.title, 'Renamed'],
    });
    expect(proved(pair)).toEqual(empty);
  });

  it('says what changed of an item, by the names the project gives', () => {
    const pair = versions((now) => {
      const held = item(now, 'A');
      held.metadata = { ...held.metadata, custom: { X: 'value' }, includeInCompile: false };
      held.keywords = ['K'];
    });
    pair.was.project.customFields = [{ id: 'X', type: 'Text', title: 'Field' }];
    pair.now.project.customFields = [{ id: 'X', type: 'Text', title: 'Field' }];
    const word = { id: 'K', title: 'Word', color: [0, 0, 0], children: [] };
    pair.now.project.keywords = [{ id: 'P', title: 'Topic', color: [0, 0, 0], children: [word] }];
    const [change] = compareProjects(pair.was, pair.now).items;
    expect(change).toMatchObject({ kind: 'changed', id: 'A' });
    const fields = change?.kind === 'changed' ? change.fields : [];
    expect(fields.find(({ field }) => field === 'keywords')).toMatchObject({ now: ['Word'] });
    expect(fields.map(({ field }) => field).toSorted()).toEqual(
      ['Field', 'includeInCompile', 'keywords'].toSorted(),
    );
  });

  it('says a reorder only of what changed its place among the same items', () => {
    const pair = versions(({ project }) => {
      const { children } = project.binder[0]!;
      children.push(children.shift()!);
    });
    const { items } = compareProjects(pair.was, pair.now);
    expect(items).toMatchObject([{ kind: 'reordered', id: 'A', was: 0, now: 2 }]);
    expect(proved(pair)).toEqual(empty);
  });

  it('says what was removed from the binder, and takes it out', () => {
    const pair = versions(({ project }) => void project.binder[0]!.children.shift());
    const { items, documents } = compareProjects(pair.was, pair.now);
    expect(items).toMatchObject([{ kind: 'removed', id: 'A' }]);
    expect(documents.map((change) => [change.item, change.title])).toEqual([['A', 'A']]);
    expect(documents[0]!.lines.every(({ kind }) => kind === 'removed')).toBe(true);
    expect(proved(pair)).toEqual(empty);
  });

  it('compares text, notes and synopses by item, with a title and path', () => {
    const pair = versions(({ documents }) => {
      const content = documents.text('A');
      const [node] = content.paragraphs[0]!.content;
      if (node?.kind === 'text') node.text = 'first words changed';
      return {
        documents: new Map([
          ['A', { content }],
          ['B', { synopsis: 'new gist' }],
        ]),
      };
    });
    const { documents, synopses } = compareProjects(pair.was, pair.now);
    expect(documents).toMatchObject([{ item: 'A', title: 'A', part: 'content' }]);
    expect(synopses).toMatchObject([{ item: 'B', was: 'gist', now: 'new gist' }]);
    expect(proved(pair)).toEqual(empty);
  });

  it('compares styles, a renamed one only as itself, and settings and compile choices', () => {
    const pair = versions(({ project }) => {
      project.styles[0]!.name = 'Renamed';
      project.styles.push({ ...project.styles[1]!, id: 'NEW', name: 'New' });
      project.styles.splice(1, 1);
      project.labelSettings.title = 'Tags';
      project.compileSettings!.currentFileType = 'other';
    });
    const compared = compareProjects(pair.was, pair.now);
    expect(compared.documents).toEqual([]);
    expect(compared.styles.map(({ kind }) => kind).toSorted()).toEqual([
      'added',
      'changed',
      'removed',
    ]);
    expect(compared.settings).toMatchObject([{ path: ['labelSettings', 'title'], now: 'Tags' }]);
    expect(compared.compile).toHaveLength(1);
    expect(proved(pair)).toEqual(empty);
  });

  it("compares the project's own formats, added, changed and removed", () => {
    const pair = versions(() => {});
    addFormat(pair.now.project.dir);
    const compared = compareProjects(pair.was, pair.now);
    expect(compared.formats).toMatchObject([{ kind: 'added' }]);
    expect(proved(pair)).toEqual(empty);
    expect(compareProjects(pair.now, open(template())).formats).toMatchObject([
      { kind: 'removed' },
    ]);
  });
});

const removing = (kind: 'remove-item') => [{ kind, item: 'NONE' }];

describe('edits between projects', () => {
  it('takes a format that went, and changes one that changed', () => {
    const was = template();
    addFormat(was);
    const now = template();
    renameLayout(now);
    const { formats } = compareProjects(open(was), open(now));
    expect(formats.map(({ kind }) => kind).toSorted()).toEqual(['changed', 'removed']);
    expect(proved({ was: open(was), now: open(now) })).toEqual(empty);
  });

  it('says a keyword it has no title for by its ID, and needs no trash', () => {
    expect(compareProjects(open(plain()), open(plain())).items).toEqual([]);
    const { was, now } = versions((version) => void item(version, 'A').keywords.push('NOPE'));
    const [change] = compareProjects(was, now).items;
    expect(JSON.stringify(change)).toContain('NOPE');
  });

  it('says a custom field it has no title for by its ID', () => {
    const { was, now } = versions((version) => {
      item(version, 'A').metadata!.custom.NOPE = 'value';
    });
    expect(JSON.stringify(compareProjects(was, now).items)).toContain('NOPE');
  });

  it('adds an item at the top of the binder', () => {
    const pair = versions(({ project }) => void project.binder.push(newBinderItem('Text', 'Top')));
    expect(proved(pair)).toEqual(empty);
  });

  it('takes the metadata an item no longer has', () => {
    const version = open(template());
    const { metadata: _metadata, ...bare } = item(version, 'A');
    applyProjectEdits(version, [{ kind: 'set-item', item: bare }]);
    expect(item(version, 'A').metadata).toBeUndefined();
  });

  it('carries every setting a project holds', () => {
    const was = open(template());
    const now = open(template());
    const held = {
      keywords: [],
      projectBookmarks: [],
      templateFolderId: 'A',
      bookmarksFolderId: 'B',
      autoComplete: [],
      externalSyncMap: [],
    };
    Object.assign(now.project, held);
    expect(projectEdits(was, now)).toMatchObject([{ kind: 'settings', settings: held }]);
  });

  it('reads the sample of a style as a reader sees it', () => {
    const { project, documents } = open(template());
    const format = documents.text('A');
    const { sample } = styleFace(project, { ...project.styles[0]!, format });
    expect(sample).toHaveLength(format.paragraphs.length);
  });

  it('stops on an item that is not there, as when what it follows was left out', () => {
    const { project, documents } = open(template());
    const version = { project, documents };
    expect(() => applyProjectEdits(version, removing('remove-item'))).toThrow('no item NONE');
    const added = { kind: 'add-item', item: item(version, 'A'), parent: 'NONE', index: 0 } as const;
    expect(() => applyProjectEdits(version, [added])).toThrow('no item NONE');
    const set = { kind: 'set-item', item: { ...item(version, 'A'), id: 'NONE' } } as const;
    expect(() => applyProjectEdits(version, [set])).toThrow('no item NONE');
  });
});

const words = ({ documents }: ProjectVersion) =>
  markupText(documents.text('A').paragraphs[0]!.content);

/** Base, and two sides as `ours` and `theirs` leave copies of it, saved. */
function sides(
  ours: Parameters<typeof versions>[0],
  theirs: Parameters<typeof versions>[0],
  choose?: Parameters<typeof mergeProjects>[3],
) {
  const base = open(template());
  const mine = versions(ours).now;
  const other = versions(theirs).now;
  const result = mergeProjects(base, mine, other, choose);
  saveProject(result.project, result.changes);
  return { ...result, merged: open(mine.project.dir), other };
}

const reworded =
  (id: string, from: string, to: string) =>
  ({ documents }: ProjectVersion) => {
    const content = documents.text(id);
    const [node] = content.paragraphs[0]!.content;
    if (node?.kind === 'text') node.text = node.text.replace(from, to);
    return { documents: new Map<string, ItemDocumentsChange>([[id, { content }]]) };
  };

const oursWords = (now: ProjectVersion) => {
  const changes = reworded('A', 'first', 'ours')(now);
  changes.documents.set('B', { synopsis: 'ours' });
  return changes;
};

const theirsWords = (now: ProjectVersion) => {
  const changes = reworded('A', 'first', 'theirs')(now);
  changes.documents.set('B', { synopsis: 'theirs' });
  return changes;
};

describe('merging projects', () => {
  it('saves a format the other side changed to the file it came from', () => {
    const theirs = template();
    renameLayout(theirs);
    const mine = open(template());
    const result = mergeProjects(open(template()), mine, open(theirs));
    saveProject(result.project, result.changes);
    expect(compareProjects(open(mine.project.dir), open(theirs)).formats).toEqual([]);
  });

  it('keeps both sides: binder, documents and stamps, with no conflict', () => {
    const { conflicts, merged } = sides(
      (now) => {
        addItem('Text', 'Ours', { parent: now.project.binder[0]! });
        return reworded('A', 'first', 'FIRST')(now);
      },
      (now) => {
        addItem('Text', 'Theirs', { parent: now.project.binder[0]! });
        return reworded('A', 'here', 'HERE')(now);
      },
    );
    expect(conflicts).toEqual([]);
    const titles = merged.project.binder[0]!.children.map(({ title }) => title);
    expect(titles.slice(-2)).toEqual(['Ours', 'Theirs']);
    expect(words(merged)).toBe('FIRST words HERE');
    expect(() =>
      compileModel(readModel(merged.project), { onLeftAsWritten: () => {} }),
    ).not.toThrow();
  });

  it('gives typed conflicts for words and a synopsis, and keeps ours until chosen', () => {
    const { conflicts, merged } = sides(oursWords, theirsWords);
    expect(conflicts).toMatchObject([
      { kind: 'document', item: 'A', part: 'content', conflict: { reason: 'words' } },
      { kind: 'value', path: ['synopsis', 'B'] },
    ]);
    expect(words(merged)).toBe('ours words here');
    expect(words(sides(oursWords, theirsWords, () => 'theirs').merged)).toBe('theirs words here');
  });

  it('rejects a commit: the parent over the project, with the commit as the base', () => {
    const parent = open(template());
    const commit = versions(reworded('A', 'first', 'rejected')).now;
    const later = versions((now) => {
      const content = now.documents.text('A');
      const [node] = content.paragraphs[0]!.content;
      if (node?.kind === 'text') node.text = 'rejected words kept';
      return { documents: new Map([['A', { content }]]) };
    }).now;
    const { project, changes, conflicts } = mergeProjects(commit, later, parent);
    saveProject(project, changes);
    expect(conflicts).toEqual([]);
    expect(words(open(later.project.dir))).toBe('first words kept');
  });

  it('takes settings, styles, compile choices and formats from the side that changed them', () => {
    const { conflicts, merged } = sides(
      ({ project }) => {
        project.styles[0]!.name = 'Ours';
      },
      ({ project }) => {
        project.styles[1]!.name = 'Theirs';
        project.compileSettings!.currentFileType = 'other';
        addFormat(project.dir);
      },
    );
    expect(conflicts).toEqual([]);
    const names = merged.project.styles.map(({ name }) => name);
    expect(names).toContain('Ours');
    expect(names).toContain('Theirs');
    expect(merged.project.compileSettings?.currentFileType).toBe('other');
    const folder = path.join(merged.project.dir, 'Settings', 'Compile Formats');
    expect(fs.readdirSync(folder)).toContain('Other.scrformat');
  });

  it('takes a synopsis only the other side changed', () => {
    const { conflicts, merged } = sides(
      () => {},
      () => ({ documents: new Map([['B', { synopsis: 'theirs' }]]) }),
    );
    expect(conflicts).toEqual([]);
    expect(merged.documents.synopsis('B')).toBe('theirs');
  });

  it('leaves a document whose file differs only in how it is written', () => {
    const { conflicts, changes } = sides(reworded('A', 'first', 'ours'), ({ project }) => {
      fs.appendFileSync(path.join(project.dir, 'Files', 'Data', 'A', 'content.rtf'), '\n');
    });
    expect(conflicts).toEqual([]);
    expect(changes.documents?.has('A')).toBe(false);
  });

  it('needs no compile settings', () => {
    const [base, mine, other] = [open(template()), open(template()), open(template())];
    for (const { project } of [base, mine, other]) delete project.compileSettings;
    const { project } = mergeProjects(base, mine, other);
    expect(project.compileSettings).toBeUndefined();
  });
});
