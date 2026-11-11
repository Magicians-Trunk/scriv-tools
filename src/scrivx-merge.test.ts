import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import type { BinderItem } from './binder-item.ts';
import { flatten, openProject } from './project.ts';
import { mergeScrivx, mergeScrivxText } from './scrivx-merge.ts';
import { type Scrivx, writeScrivx } from './scrivx.ts';

const dir = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'basic.scriv');

/** The fixture's project file as a model, a fresh copy each time. */
function scrivx(): Scrivx {
  const {
    dir: _dir,
    files: _files,
    file: _file,
    styles: _s,
    unsupported: _u,
    ...held
  } = openProject(dir);
  return structuredClone(held);
}

/** Base, and two sides as `change` leaves copies of it. */
function sides(ours: (side: Scrivx) => void = () => {}, theirs: (side: Scrivx) => void = () => {}) {
  const [base, mine, other] = [scrivx(), scrivx(), scrivx()];
  ours(mine);
  theirs(other);
  return mergeScrivx(base, mine, other);
}

const draft = (side: Scrivx) => side.binder.find(({ type }) => type === 'DraftFolder')!;
const research = (side: Scrivx) => side.binder.find(({ type }) => type === 'ResearchFolder')!;
const item = (side: Scrivx, id: string) => flatten(side.binder).find((each) => each.id === id)!;
const firstCustom = (side: Scrivx) => draft(side).children[0]!.metadata!.custom;
const reverseTop = (side: Scrivx) => {
  side.binder = side.binder.toReversed();
};
const rollTop = (side: Scrivx) => void side.binder.push(side.binder.shift()!);
const titles = (items: BinderItem[]) => items.map(({ title }) => title);
const newItem = (id: string, title: string): BinderItem => ({
  id,
  type: 'Text',
  created: '2026-11-06 01:00:00 -0500',
  modified: '2026-11-06 01:00:00 -0500',
  title,
  keywords: [],
  bookmarks: [],
  children: [],
});

const label = (id: string, name: string) => ({ id, name });

const stamped = (id: string, title: string) => {
  const side = scrivx();
  side.modId = id;
  draft(side).children.push(newItem(id, title));
  return writeScrivx(side);
};

describe('merging the project file', () => {
  it('never conflicts on the stamps, and takes the later', () => {
    const { merged, conflicts } = sides(
      (side) => {
        side.modified = '2026-11-06 01:00:00 -0500';
        side.modId = 'OURS';
      },
      (side) => {
        side.modified = '2026-11-06 02:00:00 -0500';
        side.modId = 'THEIRS';
      },
    );
    expect(conflicts).toEqual([]);
    expect(merged.modId).toBe('THEIRS');
    expect(sides((side) => void (side.modId = 'OURS')).merged.modId).toBe('OURS');
  });

  it('keeps items both sides added, ours first, and where each put it', () => {
    const { merged, conflicts } = sides(
      (side) => void draft(side).children.push(newItem('N1', 'Ours')),
      (side) => void draft(side).children.push(newItem('N2', 'Theirs')),
    );
    expect(conflicts).toEqual([]);
    expect(titles(draft(merged).children).slice(-2)).toEqual(['Ours', 'Theirs']);
    const first = sides(
      undefined,
      (side) => void draft(side).children.unshift(newItem('N3', 'Top')),
    );
    expect(titles(draft(first.merged).children)[0]).toBe('Top');
  });

  it('merges an item field by field, and conflicts on one changed two ways', () => {
    const id = draft(scrivx()).children[0]!.id;
    const both = sides(
      (side) => void (item(side, id).title = 'Renamed'),
      (side) => void (item(side, id).metadata = { custom: { F: 'value' }, labelId: '3' }),
    );
    expect(both.conflicts).toEqual([]);
    expect(item(both.merged, id)).toMatchObject({
      title: 'Renamed',
      metadata: { labelId: '3', custom: { F: 'value' } },
    });
    const clash = sides(
      (side) => void (item(side, id).title = 'Ours'),
      (side) => void (item(side, id).title = 'Theirs'),
    );
    expect(clash.conflicts).toMatchObject([{ kind: 'value', path: ['binder', id, 'title'] }]);
    expect(item(clash.merged, id).title).toBe('Ours');
  });

  it('never conflicts on selections and how an item was shown, and takes the later stamp', () => {
    const id = draft(scrivx()).children[0]!.id;
    const { merged, conflicts } = sides(
      (side) => {
        item(side, id).textSettings = { textSelection: [1, 1] };
        item(side, id).corkboardAndOutliner = { expandedIds: ['A'] };
      },
      (side) => {
        item(side, id).textSettings = { textSelection: [2, 2] };
        item(side, id).modified = '2030-01-01 00:00:00 -0500';
        item(side, id).metadata = { custom: {}, notesTextSelection: [3, 3] };
      },
    );
    expect(conflicts).toEqual([]);
    expect(item(merged, id).textSettings).toEqual({ textSelection: [1, 1] });
    expect(item(merged, id).modified).toBe('2030-01-01 00:00:00 -0500');
    expect(item(merged, id).metadata?.notesTextSelection).toEqual([3, 3]);
  });

  it('follows a move on one side, and conflicts on two moves or a loop', () => {
    const [first, second] = draft(scrivx()).children;
    const move = (side: Scrivx, id: string, to: BinderItem) => {
      const from = draft(side);
      const [held] = from.children.splice(
        from.children.findIndex((each) => each.id === id),
        1,
      );
      to.children.push(held!);
    };
    const moved = sides(undefined, (side) => move(side, first!.id, research(side)));
    expect(moved.conflicts).toEqual([]);
    expect(research(moved.merged).children.map(({ id }) => id)).toContain(first!.id);
    expect(draft(moved.merged).children.map(({ id }) => id)).not.toContain(first!.id);
    const twice = sides(
      (side) => move(side, first!.id, research(side)),
      (side) => move(side, first!.id, item(side, second!.id)),
    );
    expect(twice.conflicts).toMatchObject([{ kind: 'binder', item: first!.id, reason: 'moved' }]);
    const loop = sides(
      (side) => move(side, first!.id, item(side, second!.id)),
      (side) => move(side, second!.id, item(side, first!.id)),
    );
    expect(loop.conflicts.map((each) => each.kind)).toContain('binder');
    expect(flatten(loop.merged.binder).filter(({ id }) => id === first!.id)).toHaveLength(1);
  });

  it('removes what one side removed, unless the other changed it', () => {
    const id = draft(scrivx()).children[0]!.id;
    const remove = (side: Scrivx) => void draft(side).children.shift();
    expect(sides(remove).conflicts).toEqual([]);
    expect(flatten(sides(remove).merged.binder).map((each) => each.id)).not.toContain(id);
    expect(flatten(sides(remove, remove).merged.binder).map((each) => each.id)).not.toContain(id);
    const kept = sides(remove, (side) => void (item(side, id).title = 'Changed'));
    expect(kept.conflicts).toMatchObject([{ kind: 'binder', item: id, reason: 'removed' }]);
    expect(item(kept.merged, id).title).toBe('Changed');
  });

  it('brings back a folder removed from under what the other side added', () => {
    const id = draft(scrivx()).children[0]!.id;
    const { merged, conflicts } = sides(
      (side) => void draft(side).children.shift(),
      (side) => void item(side, id).children.push(newItem('N1', 'Under')),
    );
    expect(conflicts).toMatchObject([{ kind: 'binder', item: id, reason: 'removed' }]);
    expect(titles(item(merged, id).children)).toEqual(['Under']);
  });

  it("takes one side's order, and conflicts when both reordered", () => {
    const swap = (side: Scrivx) => {
      const folder = draft(side);
      folder.children = folder.children.toReversed();
    };
    const roll = (side: Scrivx) => {
      const { children } = draft(side);
      children.push(children.shift()!);
    };
    const was = titles(draft(scrivx()).children);
    expect(titles(draft(sides(undefined, swap).merged).children)).toEqual(was.toReversed());
    expect(sides(swap, swap).conflicts).toEqual([]);
    const clash = sides(swap, roll);
    expect(clash.conflicts).toMatchObject([{ kind: 'binder', reason: 'order' }]);
  });

  it('conflicts when both reorder the top of the binder', () => {
    expect(sides(reverseTop, rollTop).conflicts).toMatchObject([
      { kind: 'binder', item: '', reason: 'order' },
    ]);
  });

  it('takes away a custom field one side removed', () => {
    const [base, mine, other] = [scrivx(), scrivx(), scrivx()];
    for (const side of [base, mine]) firstCustom(side).FIELD = 'held';
    expect(firstCustom(mergeScrivx(base, mine, other).merged)).toEqual({});
  });

  it('merges lists of things by ID, and values one side changed', () => {
    const { merged, conflicts } = sides(
      (side) => void side.labelSettings.labels.push(label('90', 'Ours')),
      (side) => {
        side.labelSettings.labels.push(label('91', 'Theirs'));
        side.labelSettings.title = 'Tags';
        side.statusSettings.statuses.pop();
        side.keywords = [{ id: 'K', title: 'Word', color: [0, 0, 0], children: [] }];
        side.autoComplete = [{ scope: 'all', word: 'word' }];
      },
    );
    expect(conflicts).toEqual([]);
    expect(merged.labelSettings.title).toBe('Tags');
    expect(merged.labelSettings.labels.map(({ name }) => name).slice(-2)).toEqual([
      'Ours',
      'Theirs',
    ]);
    expect(merged.statusSettings.statuses).toHaveLength(
      scrivx().statusSettings.statuses.length - 1,
    );
    expect(merged.keywords).toHaveLength(1);
    expect(merged.autoComplete).toHaveLength(1);
    const clash = sides(
      (side) => void (side.labelSettings.labels[0]!.name = 'Ours'),
      (side) => void (side.labelSettings.labels[0]!.name = 'Theirs'),
    );
    expect(clash.conflicts).toHaveLength(1);
    const order = sides(
      (side) => {
        side.labelSettings.labels = side.labelSettings.labels.toReversed();
      },
      (side) => void side.labelSettings.labels.push(side.labelSettings.labels.shift()!),
    );
    expect(order.conflicts).toHaveLength(1);
  });

  it('merges the text of three files, as a driver gets them, stamp and all', () => {
    const file = fs.readFileSync(path.join(dir, 'basic.scrivx'), 'utf8');
    const { text, conflicts } = mergeScrivxText(file, stamped('A', 'Ours'), stamped('B', 'Theirs'));
    expect(conflicts).toEqual([]);
    expect(text).toContain('<Title>Ours</Title>');
    expect(text).toContain('<Title>Theirs</Title>');
    expect(() => mergeScrivxText('<Other/>', file, file)).toThrow('holds no project');
  });
});
