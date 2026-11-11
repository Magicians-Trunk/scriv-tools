/** What a project lets its items be: its labels, statuses and custom fields. */
import type { BinderItem } from './binder-item.ts';
import { EditError } from './edit-pieces.ts';
import { flatten, NONE_ID, type Project } from './project.ts';
import type {
  Color,
  CustomField,
  CustomFieldType,
  Label,
  LabelSettings,
  ListOption,
  StatusSettings,
} from './scrivx.ts';

/** The colours a label takes in turn, soft enough for text to sit on. */
const LABEL_COLORS: Color[] = [
  [0.7, 0.89, 0.97],
  [0.72, 0.95, 0.7],
  [1.0, 0.89, 0.65],
  [0.99, 0.79, 0.65],
  [0.99, 0.7, 0.73],
  [0.96, 0.77, 1.0],
];

/** A list of names with the entry that means none of them first, each by a number as its ID. */
function numbered<Entry extends { id: string }>(
  none: Entry,
  names: string[],
  make: (id: string, name: string, at: number) => Entry,
) {
  return [none, ...names.map((name, at) => make(String(at), name, at))];
}

/** Gives the project these labels, in place of what it had. */
export function setLabels(
  { labelSettings }: Pick<Project, 'labelSettings'>,
  names: string[],
): void {
  const none = labelSettings.labels.find(({ id }) => id === NONE_ID)!;
  labelSettings.labels = numbered<Label>(none, names, (id, name, at) => ({
    id,
    name,
    color: LABEL_COLORS[at % LABEL_COLORS.length]!,
  }));
}

/** Gives the project these statuses, in place of what it had. */
export function setStatuses(
  { statusSettings }: Pick<Project, 'statusSettings'>,
  names: string[],
): void {
  const none = statusSettings.statuses.find(({ id }) => id === NONE_ID)!;
  statusSettings.statuses = numbered(none, names, (id, name) => ({ id, name }));
}

/** How many items use each entry of a project's lists, by ID. */
export interface ListUses {
  labels: Record<string, number>;
  statuses: Record<string, number>;
  fields: Record<string, number>;
  /** A list field's options, by the field's ID. */
  options: Record<string, Record<string, number>>;
}

const counted = (counts: Record<string, number>, id: string) => {
  counts[id] = (counts[id] ?? 0) + 1;
};

/** How many items use each label, status, custom field and list option. */
export function listUses({ binder, customFields }: Pick<Project, 'binder' | 'customFields'>) {
  const uses: ListUses = { labels: {}, statuses: {}, fields: {}, options: {} };
  const lists = new Set(customFields.filter(({ type }) => type === 'List').map(({ id }) => id));
  for (const { metadata } of flatten(binder)) {
    if (metadata?.labelId !== undefined) counted(uses.labels, metadata.labelId);
    if (metadata?.statusId !== undefined) counted(uses.statuses, metadata.statusId);
    for (const [field, value] of Object.entries(metadata?.custom ?? {})) {
      counted(uses.fields, field);
      if (lists.has(field)) counted((uses.options[field] ??= {}), value);
    }
  }
  return uses;
}

/** A new entry for a list, numbered after those there are, as Scrivener numbers them. */
export function newListEntry(entries: ListOption[], name: string): ListOption {
  return { id: String(Math.max(-1, ...entries.map(({ id }) => Number(id))) + 1), name };
}

/** A new label, in the next colour.  `labels` holds the entry for none. */
export function newLabel(labels: Label[], name: string): Label {
  const color = LABEL_COLORS[(labels.length - 1) % LABEL_COLORS.length]!;
  return { ...newListEntry(labels, name), color };
}

/** Refuses names the project could not tell apart, as a choice goes by its name. */
function refuseNames(kind: string, names: string[]) {
  if (names.some((name) => name.trim() === '')) {
    throw new EditError(`A ${kind} needs a name.`);
  }
  const repeated = names.find((name, at) => names.indexOf(name) !== at);
  if (repeated !== undefined) throw new EditError(`Two of the ${kind}s are called "${repeated}".`);
}

/** The IDs that stay of a list whose items are about to follow it, with its entry for none. */
function keptIds(kind: string, title: string, entries: ListOption[]) {
  if (title.trim() === '') throw new EditError(`The ${kind} list needs a title.`);
  refuseNames(
    kind,
    entries.map(({ name }) => name),
  );
  if (!entries.some(({ id }) => id === NONE_ID)) {
    throw new EditError(`The ${kind} list must keep its entry for none.`);
  }
  return new Set(entries.map(({ id }) => id));
}

/** Clears an ID the list no longer has from every item. */
function clearGone(
  { binder }: Pick<Project, 'binder'>,
  key: 'labelId' | 'statusId',
  kept: Set<string>,
) {
  for (const item of flatten(binder)) {
    const id = item.metadata?.[key];
    if (id === undefined || kept.has(id)) continue;
    const { [key]: _gone, ...rest } = item.metadata!;
    item.metadata = rest;
  }
}

/** Gives the project this label list; items with a label it lost have none. */
export function setLabelSettings(
  project: Pick<Project, 'binder' | 'labelSettings'>,
  settings: LabelSettings,
) {
  const kept = keptIds('label', settings.title, settings.labels);
  clearGone(project, 'labelId', kept);
  project.labelSettings = {
    ...settings,
    defaultId: kept.has(settings.defaultId) ? settings.defaultId : NONE_ID,
  };
}

/** Gives the project this status list; items with a status it lost have none. */
export function setStatusSettings(
  project: Pick<Project, 'binder' | 'statusSettings'>,
  settings: StatusSettings,
) {
  const kept = keptIds('status', settings.title, settings.statuses);
  clearGone(project, 'statusId', kept);
  project.statusSettings = {
    ...settings,
    defaultId: kept.has(settings.defaultId) ? settings.defaultId : NONE_ID,
  };
}

/** Gives a new item the label and status the project starts items with. */
export function giveDefaults(
  { labelSettings, statusSettings }: Pick<Project, 'labelSettings' | 'statusSettings'>,
  item: BinderItem,
) {
  const { defaultId: labelId } = labelSettings;
  const { defaultId: statusId } = statusSettings;
  item.metadata = {
    ...item.metadata!,
    ...(labelId === NONE_ID ? {} : { labelId }),
    ...(statusId === NONE_ID ? {} : { statusId }),
  };
}

/** A field's ID, as Scrivener makes one from its title, kept apart from those there are. */
function fieldId(title: string, fields: CustomField[]) {
  const made = title.toLowerCase().replaceAll(/[^a-z0-9]/g, '') || 'field';
  const taken = new Set(fields.map(({ id }) => id));
  let id = made;
  for (let next = 2; taken.has(id); next += 1) id = `${made}${next}`;
  return id;
}

/** What a field of each type holds beside its ID and title, as Scrivener writes a new one. */
const FIELD_SHAPES: Record<CustomFieldType, Partial<CustomField>> = {
  Text: { wraps: false, align: 'Left' },
  Checkbox: { defaultChecked: false },
  List: { listOptions: { none: 'None', options: [] } },
  Date: { dateType: 'Short', dateFormat: '' },
};

const shaped = (id: string, title: string, type: CustomFieldType): CustomField => ({
  id,
  type,
  title,
  ...structuredClone(FIELD_SHAPES[type]),
});

/** A new field among these. */
export function newCustomField(fields: CustomField[], title: string, type: CustomFieldType) {
  return shaped(fieldId(title, fields), title, type);
}

/** A field made another type: its ID and title stay, and what its old type held goes. */
export const retypedField = ({ id, title }: CustomField, type: CustomFieldType) =>
  shaped(id, title, type);

/** Adds a field, and gives back its ID.  Two fields cannot share a title. */
export function addCustomField(
  { customFields }: Pick<Project, 'customFields'>,
  title: string,
  type: CustomFieldType = 'Text',
): string {
  if (customFields.some((field) => field.title.toLowerCase() === title.toLowerCase())) {
    throw new EditError(`The project already has a custom field "${title}".`);
  }
  const field = newCustomField(customFields, title, type);
  customFields.push(field);
  return field.id;
}

/** Whether an item's value still means anything in the field as it now is. */
function valueStays(was: CustomField, now: CustomField | undefined, value: string) {
  if (now?.type !== was.type) return false;
  return now.type !== 'List' || now.listOptions!.options.some(({ id }) => id === value);
}

/**
 * Gives the project these fields, in this order.  A field keeps its ID, so its values follow a
 * new title; items lose their value in a field that went, changed type, or lost that option.
 */
export function setCustomFields(
  project: Pick<Project, 'binder' | 'customFields'>,
  fields: CustomField[],
) {
  refuseNames(
    'custom field',
    fields.map(({ title }) => title),
  );
  for (const { title, listOptions } of fields) {
    refuseNames(
      `choice of ${title}`,
      (listOptions?.options ?? []).map(({ name }) => name),
    );
  }
  const now = new Map(fields.map((field) => [field.id, field]));
  for (const was of project.customFields) {
    for (const item of flatten(project.binder)) {
      const value = item.metadata?.custom[was.id];
      if (value === undefined || valueStays(was, now.get(was.id), value)) continue;
      const { [was.id]: _gone, ...custom } = item.metadata!.custom;
      item.metadata = { ...item.metadata!, custom };
    }
  }
  project.customFields = fields;
}
