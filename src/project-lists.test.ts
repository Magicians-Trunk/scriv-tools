import { describe, expect, it } from 'vite-plus/test';
import { textBytes } from './files.ts';
import { memoryFiles } from './memory-files.ts';
import { createProject } from './new-project.ts';
import type { BinderItem } from './binder-item.ts';
import {
  addCustomField,
  giveDefaults,
  listUses,
  newCustomField,
  newLabel,
  newListEntry,
  retypedField,
  setCustomFields,
  setLabels,
  setLabelSettings,
  setStatuses,
  setStatusSettings,
} from './project-lists.ts';
import { flatten, labelName, openProject, statusName } from './project.ts';
import { type CustomField, scrivxFile, writeScrivx } from './scrivx.ts';
import { readXml } from './xml.ts';
import { newUnread, unreadList } from './xml-codec.ts';
import { saveProject } from './save.ts';

const created = () => createProject('/work', 'Lists', memoryFiles());

describe("a project's lists", () => {
  it('replaces the labels and statuses, keeping the entry for none, and saves them', () => {
    const project = created();
    setLabels(project, ['Guide', 'Policy']);
    setStatuses(project, ['Draft']);
    expect(project.labelSettings.labels.map(({ id, name }) => [id, name])).toEqual([
      ['-1', 'No Label'],
      ['0', 'Guide'],
      ['1', 'Policy'],
    ]);
    expect(project.labelSettings.labels[1]!.color).toHaveLength(3);
    expect(project.statusSettings.statuses.map(({ name }) => name)).toEqual(['No Status', 'Draft']);
    saveProject(project);
    const read = openProject(project.dir, project.files);
    const item = { ...read.binder[0]!, metadata: { custom: {}, labelId: '1', statusId: '0' } };
    expect(labelName(read, item)).toBe('Policy');
    expect(statusName(read, item)).toBe('Draft');
  });

  it('colours as many labels as it is given', () => {
    const project = created();
    setLabels(project, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(project.labelSettings.labels[7]!.color).toEqual(project.labelSettings.labels[1]!.color);
  });

  it('adds a text field under an ID made from its title', () => {
    const project = created();
    expect(addCustomField(project, 'Last Tested')).toBe('lasttested');
    expect(project.customFields).toEqual([
      { id: 'lasttested', type: 'Text', wraps: false, align: 'Left', title: 'Last Tested' },
    ]);
    expect(() => addCustomField(project, 'last tested')).toThrow('already has');
  });
});

/** The four types as Scrivener 3.5.2 writes them, with an item holding a value of each. */
const FIELD_SETTINGS = `<CustomMetaDataSettings>
        <MetaDataField ID="owner" Type="Text" Wraps="No" Align="Left">
            <Title>Owner</Title>
        </MetaDataField>
        <MetaDataField ID="reviewed" Type="Checkbox" Default="Yes">
            <Title>Reviewed</Title>
        </MetaDataField>
        <MetaDataField ID="component" Type="List">
            <Title>Component</Title>
            <ListOptions None="None">
                <Option ID="0">Parser</Option>
                <Option ID="1">Renderer</Option>
            </ListOptions>
        </MetaDataField>
        <MetaDataField ID="due" Type="Date" DateType="Short">
            <Title>Due</Title>
            <DateFormat></DateFormat>
        </MetaDataField>
        <MetaDataField ID="released" Type="Date" DateType="Custom" Absolute="Yes">
            <Title>Released</Title>
            <DateFormat>yyyy-MM-dd</DateFormat>
        </MetaDataField>
    </CustomMetaDataSettings>`;

const valued = (id: string, custom: Record<string, string>, labelId?: string): BinderItem => ({
  id,
  type: 'Text',
  created: '',
  modified: '',
  metadata: { includeInCompile: true, custom, ...(labelId ? { labelId, statusId: labelId } : {}) },
  keywords: [],
  bookmarks: [],
  children: [],
});

/** A project with one field of each type, and two items using them. */
function fielded() {
  const project = created();
  const none = { title: 'Label', defaultId: '-1' };
  project.labelSettings = {
    ...none,
    labels: [
      { id: '-1', name: 'No Label' },
      { id: '0', name: 'Guide', color: [0.5, 0.25, 1] },
      { id: '1', name: 'Policy' },
    ],
  };
  project.statusSettings = {
    title: 'Status',
    defaultId: '0',
    statuses: [
      { id: '-1', name: 'No Status' },
      { id: '0', name: 'Draft' },
    ],
  };
  project.customFields = [
    { id: 'owner', type: 'Text', wraps: false, align: 'Left', title: 'Owner' },
    {
      id: 'component',
      type: 'List',
      title: 'Component',
      listOptions: {
        none: 'None',
        options: [
          { id: '0', name: 'Parser' },
          { id: '1', name: 'Renderer' },
        ],
      },
    },
  ];
  project.binder[0]!.children.push(
    valued('A', { owner: 'Ada', component: '1' }, '0'),
    valued('B', { component: '1' }),
  );
  return project;
}

const items = (project: { binder: BinderItem[] }) =>
  Object.fromEntries(
    flatten(project.binder)
      .filter(({ id }) => id.length === 1)
      .map(({ id, metadata }) => [id, metadata]),
  );

describe('the field types in the project file', () => {
  it('writes back each type byte for byte, with nothing left unread', () => {
    const files = memoryFiles();
    const blank = writeScrivx(created());
    const written = blank.replace('</StatusSettings>', `</StatusSettings>\n    ${FIELD_SETTINGS}`);
    files.write('/p.scrivx', textBytes(written));
    const unread = newUnread();
    const read = scrivxFile.read(readXml('/p.scrivx', 'ScrivenerProject', files), unread);
    expect(unreadList(unread)).toEqual([]);
    expect(read.customFields.map(({ type }) => type)).toEqual([
      'Text',
      'Checkbox',
      'List',
      'Date',
      'Date',
    ]);
    expect(read.customFields[4]).toMatchObject({ absolute: true, dateFormat: 'yyyy-MM-dd' });
    expect(writeScrivx(read)).toBe(written);
  });
});

describe('counting uses', () => {
  it('counts each label, status, field and list option', () => {
    const project = fielded();
    const { metadata: _none, ...bare } = valued('C', {});
    project.binder[0]!.children.push(bare);
    expect(listUses(project)).toEqual({
      labels: { '0': 1 },
      statuses: { '0': 1 },
      fields: { owner: 1, component: 2 },
      options: { component: { '1': 2 } },
    });
  });
});

const made = (type: CustomField['type']) => newCustomField([], 'Due By', type);

describe('managing custom fields', () => {
  it('makes each type as Scrivener does', () => {
    expect(made('Text')).toEqual({
      id: 'dueby',
      type: 'Text',
      title: 'Due By',
      wraps: false,
      align: 'Left',
    });
    expect(made('Checkbox').defaultChecked).toBe(false);
    expect(made('List').listOptions).toEqual({ none: 'None', options: [] });
    expect(made('Date')).toMatchObject({ dateType: 'Short', dateFormat: '' });
  });

  it('keeps a new ID apart from those there are, whatever the title', () => {
    const field = newCustomField([], 'Due', 'Text');
    expect(newCustomField([{ ...field, title: 'Renamed' }], 'Due', 'Text').id).toBe('due2');
    expect(newCustomField([], '!!', 'Text').id).toBe('field');
  });

  it('adds a field of a type, refusing a title it has in any case', () => {
    const project = created();
    expect(addCustomField(project, 'Ready', 'Checkbox')).toBe('ready');
    expect(project.customFields[0]!.type).toBe('Checkbox');
    expect(() => addCustomField(project, 'READY')).toThrow('already has a custom field');
  });

  it('keeps values through a new title and order', () => {
    const project = fielded();
    const [owner, component] = project.customFields;
    setCustomFields(project, [component!, { ...owner!, title: 'Maintainer' }]);
    expect(project.customFields.map(({ title }) => title)).toEqual(['Component', 'Maintainer']);
    expect(items(project).A?.custom).toEqual({ owner: 'Ada', component: '1' });
  });

  it('takes the values of a field that goes, and only those', () => {
    const project = fielded();
    setCustomFields(project, [project.customFields[1]!]);
    expect(items(project).A?.custom).toEqual({ component: '1' });
    expect(items(project).B?.custom).toEqual({ component: '1' });
  });

  it('takes the values of a field made another type, keeping its ID and title', () => {
    const project = fielded();
    const [owner, component] = project.customFields;
    const date = retypedField(component!, 'Date');
    expect(date).toEqual({
      id: 'component',
      type: 'Date',
      title: 'Component',
      dateType: 'Short',
      dateFormat: '',
    });
    setCustomFields(project, [owner!, date]);
    expect(items(project).A?.custom).toEqual({ owner: 'Ada' });
  });

  it('takes a list value only with its option', () => {
    const project = fielded();
    const [owner, component] = project.customFields;
    const kept = { none: 'None', options: [{ id: '0', name: 'Parser' }] };
    setCustomFields(project, [
      owner!,
      {
        ...component!,
        listOptions: { ...component!.listOptions!, options: [{ id: '1', name: 'Render' }] },
      },
    ]);
    expect(items(project).A?.custom.component).toBe('1');
    setCustomFields(project, [owner!, { ...component!, listOptions: kept }]);
    expect(items(project).B?.custom).toEqual({});
  });

  it('refuses a blank title, two the same, and two choices the same', () => {
    const project = fielded();
    const [owner, component] = project.customFields;
    expect(() => setCustomFields(project, [{ ...owner!, title: ' ' }])).toThrow('needs a name');
    expect(() => setCustomFields(project, [owner!, { ...component!, title: 'Owner' }])).toThrow(
      'called "Owner"',
    );
    const twice = [
      { id: '0', name: 'Parser' },
      { id: '1', name: 'Parser' },
    ];
    expect(() =>
      setCustomFields(project, [{ ...component!, listOptions: { none: '', options: twice } }]),
    ).toThrow('called "Parser"');
    expect(project.customFields).toHaveLength(2);
  });
});

describe('managing labels and statuses', () => {
  it('numbers a new entry after the highest, and colours a new label', () => {
    expect(newListEntry([{ id: '-1', name: 'None' }], 'A').id).toBe('0');
    const labels = [
      { id: '-1', name: 'None' },
      { id: '7', name: 'B' },
    ];
    expect(newListEntry(labels, 'A').id).toBe('8');
    expect(newLabel(labels, 'A').color).toHaveLength(3);
  });

  it('keeps IDs through a new name, order, colour and title', () => {
    const project = fielded();
    const [none, guide, policy] = project.labelSettings.labels;
    setLabelSettings(project, {
      title: 'Kind',
      defaultId: '1',
      labels: [none!, policy!, { ...guide!, name: 'How-to', color: [0, 0, 0] }],
    });
    expect(project.labelSettings.title).toBe('Kind');
    expect(project.labelSettings.defaultId).toBe('1');
    expect(
      labelName(
        project,
        flatten(project.binder).find(({ id }) => id === 'A')!,
      ),
    ).toBe('How-to');
  });

  it('clears a removed entry from its items, and from being the default', () => {
    const project = fielded();
    const { labels } = project.labelSettings;
    setLabelSettings(project, { title: 'Label', defaultId: '0', labels: [labels[0]!, labels[2]!] });
    expect(items(project).A?.labelId).toBeUndefined();
    expect(items(project).A?.statusId).toBe('0');
    expect(project.labelSettings.defaultId).toBe('-1');
    const { statuses } = project.statusSettings;
    setStatusSettings(project, { title: 'Stage', defaultId: '0', statuses: [statuses[0]!] });
    expect(items(project).A?.statusId).toBeUndefined();
    expect(project.statusSettings).toMatchObject({ title: 'Stage', defaultId: '-1' });
  });

  it('keeps a status default that stays', () => {
    const project = fielded();
    setStatusSettings(project, { ...project.statusSettings, title: 'Stage' });
    expect(project.statusSettings.defaultId).toBe('0');
  });

  it('refuses a blank title, a blank name, and losing the entry for none', () => {
    const project = fielded();
    const { labels } = project.labelSettings;
    const set = (title: string, list: typeof labels) =>
      setLabelSettings(project, { title, defaultId: '-1', labels: list });
    expect(() => set('', labels)).toThrow('needs a title');
    expect(() => set('Label', [labels[0]!, { id: '0', name: '' }])).toThrow('needs a name');
    expect(() => set('Label', [labels[1]!])).toThrow('entry for none');
  });

  it('gives a new item the defaults, and none when the default is none', () => {
    const project = fielded();
    const item = valued('N', {});
    giveDefaults(project, item);
    expect(item.metadata).toMatchObject({ statusId: '0' });
    expect(item.metadata?.labelId).toBeUndefined();
    giveDefaults({ ...project, labelSettings: { ...project.labelSettings, defaultId: '1' } }, item);
    expect(item.metadata?.labelId).toBe('1');
    const plain = valued('P', {});
    giveDefaults(
      { ...project, statusSettings: { ...project.statusSettings, defaultId: '-1' } },
      plain,
    );
    expect(plain.metadata?.statusId).toBeUndefined();
  });
});
