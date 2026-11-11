import { type BinderItem, type BinderItemType } from './binder-item.ts';
import { type Documents } from './document.ts';
import {
  adaptiveTitle,
  labelName,
  sectionTypeId,
  sectionTypeName,
  statusName,
  type Project,
} from './project.ts';

/** A binder item as `structure` reports it, with names in place of IDs. */
export interface StructureItem {
  id: string;
  type: BinderItemType;
  /** The binder title, or the title Scrivener derives for an untitled item. */
  title: string;
  untitled: boolean;
  /** A folder of any kind, not a document. */
  folder: boolean;
  /** The binder's own folders stay where they are. */
  movable: boolean;
  includeInCompile: boolean;
  sectionType?: string;
  label?: string;
  status?: string;
  /** Custom metadata, by field title. */
  custom: Record<string, string>;
  children: StructureItem[];
}

/** The folders every binder has. */
const BINDER_FOLDERS = new Set<BinderItemType>(['DraftFolder', 'ResearchFolder', 'TrashFolder']);

/** The project's binder, in binder order. */
export function projectStructure(project: Project, documents: Documents): StructureItem[] {
  const fieldTitles = new Map(project.customFields.map((field) => [field.id, field.title]));

  const describe = (item: BinderItem, level: number): StructureItem => {
    const result: StructureItem = {
      id: item.id,
      type: item.type,
      title: adaptiveTitle(item, documents),
      untitled: item.title === undefined,
      folder: item.type.endsWith('Folder'),
      movable: !BINDER_FOLDERS.has(item.type),
      includeInCompile: item.metadata?.includeInCompile === true,
      custom: Object.fromEntries(
        Object.entries(item.metadata?.custom ?? {}).map(([id, value]) => [
          fieldTitles.get(id) ?? id,
          value,
        ]),
      ),
      children: item.children.map((descendant) => describe(descendant, level + 1)),
    };
    const sectionType = sectionTypeName(project, sectionTypeId(project, item, level));
    if (sectionType) result.sectionType = sectionType;
    const label = labelName(project, item);
    if (label) result.label = label;
    const status = statusName(project, item);
    if (status) result.status = status;
    return result;
  };
  return project.binder.map((item) => describe(item, 0));
}
