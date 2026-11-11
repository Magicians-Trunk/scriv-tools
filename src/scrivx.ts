/**
 * The project file, `<name>.scrivx`: the binder and everything the project keeps beside it,
 * read whole into objects and written back as Scrivener writes it.
 */
import {
  type Codec,
  attribute,
  child,
  color,
  decimal,
  element,
  integer,
  list,
  listOf,
  oneOf,
  optionalAttribute,
  optionalChild,
  optionalList,
  optionalTextChild,
  repeated,
  string,
  text,
  textChild,
  textElement,
  writeXml,
  yesNo,
} from './xml-codec.ts';
import { type BinderItem, binderItem, bookmark, type Bookmark, ids } from './binder-item.ts';

/** A custom metadata field's kind. */
export type CustomFieldType = 'Text' | 'Checkbox' | 'List' | 'Date';

/** A colour: red, green and blue, each from 0 to 1. */
export type Color = number[];

/** A saved search's settings, and what it searches for. */
export interface SearchSettings {
  operator: string;
  type: string;
  customIds?: string;
  scope?: string;
  caseSensitive: boolean;
  ignoreDiacritics: boolean;
  search: string;
}

/** A collection of binder items: the binder itself, search results, a saved search, or a list. */
export interface Collection {
  type: string;
  id: string;
  color: Color;
  title: string;
  groupMode?: string;
  searchSettings?: SearchSettings;
  binderIds?: string[];
}

/** A keyword, and the keywords filed under it. */
export interface Keyword {
  id: string;
  title: string;
  color: Color;
  children: Keyword[];
}

/** A section type's ID and its name. */
export interface SectionTypeDefinition {
  id: string;
  name: string;
}

/** Section type IDs by level, from the first level down; the last covers every deeper one. */
export interface LevelTypes {
  folders: string[];
  containers: string[];
  files: string[];
}

export interface SectionTypes {
  definitions: SectionTypeDefinition[];
  levels: LevelTypes;
}

export interface Label {
  id: string;
  color?: Color;
  name: string;
}

export interface LabelSettings {
  /** What the project calls its labels. */
  title: string;
  defaultId: string;
  labels: Label[];
}

export interface Status {
  id: string;
  name: string;
}

export interface StatusSettings {
  /** What the project calls its statuses. */
  title: string;
  defaultId: string;
  statuses: Status[];
}

export interface ListOption {
  id: string;
  name: string;
}

/** A list field's options, and the name for none of them. */
export interface ListOptions {
  none: string;
  options: ListOption[];
}

export interface CustomField {
  id: string;
  type: CustomFieldType;
  wraps?: boolean;
  color?: Color;
  align?: string;
  /** Whether a checkbox is ticked on an item that was never set. */
  defaultChecked?: boolean;
  /** How a date prints, which a custom format spells out in `dateFormat`. */
  dateType?: string;
  /** Whether dates ignore time zones. */
  absolute?: boolean;
  title: string;
  dateFormat?: string;
  listOptions?: ListOptions;
}

export interface DraftTarget {
  type: string;
  countIncludedOnly: boolean;
  currentCompileGroupOnly: boolean;
  deadline: string;
  ignoreDeadline: boolean;
  count: number;
}

export interface SessionTarget {
  type: string;
  countDraftOnly: boolean;
  allowNegatives: boolean;
  nextResetDate: string;
  resetType: string;
  resetTime: string;
  determinedFromDeadline: boolean;
  writingDays: string;
  canWriteOnDeadlineDate: boolean;
  count: number;
}

export interface PreviousSession {
  words: number;
  characters: number;
  date: string;
}

export interface ProjectTargets {
  notify: boolean;
  draft: DraftTarget;
  session: SessionTarget;
  previousSession: PreviousSession;
}

/** The day's counts, for the writing history. */
export interface RecentWritingHistory {
  date: string;
  draftWordCount: number;
  draftCharCount: number;
  otherWordCount: number;
  otherCharCount: number;
}

/** A word the editor offers to complete, and where. */
export interface Completion {
  scope: string;
  word: string;
}

export interface PrintSettings {
  /** Width and height, in points. */
  paperSize: number[];
  leftMargin: number;
  rightMargin: number;
  topMargin: number;
  bottomMargin: number;
  paperType: string;
  orientation: string;
  horizontalPagination: string;
  verticalPagination: string;
  scaleFactor: number;
  horizontallyCentered: boolean;
  verticallyCentered: boolean;
  collates: boolean;
  pagesAcross: number;
  pagesDown: number;
}

/** A binder item kept in step with an external folder, and its number there. */
export interface SyncItem {
  id: string;
  number: string;
}

/** Everything in the `.scrivx` file. */
export interface Scrivx {
  identifier: string;
  version: string;
  /** The Scrivener that last saved the project, and the device it ran on. */
  creator: string;
  device: string;
  author: string;
  modified: string;
  modId: string;
  binder: BinderItem[];
  collections: Collection[];
  keywords?: Keyword[];
  sectionTypes: SectionTypes;
  labelSettings: LabelSettings;
  statusSettings: StatusSettings;
  customFields: CustomField[];
  projectBookmarks?: Bookmark[];
  targets: ProjectTargets;
  writingHistory: RecentWritingHistory;
  templateFolderId?: string;
  bookmarksFolderId?: string;
  autoComplete?: Completion[];
  printSettings: PrintSettings;
  externalSyncMap?: SyncItem[];
}

const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = ['Text', 'Checkbox', 'List', 'Date'];

const collection = element<Collection>('Collection', {
  type: attribute('Type', string),
  id: attribute('ID', string),
  color: attribute('Color', color),
  title: textChild('Title', string),
  groupMode: optionalTextChild('GroupMode', string),
  searchSettings: optionalChild(
    element<SearchSettings>('SearchSettings', {
      operator: attribute('Operator', string),
      type: attribute('Type', string),
      customIds: optionalAttribute('CustomIDs', string),
      scope: optionalAttribute('Scope', string),
      caseSensitive: attribute('CaseSensitive', yesNo),
      ignoreDiacritics: attribute('IgnoreDiacritics', yesNo),
      search: text(string),
    }),
  ),
  binderIds: optionalTextChild('BinderUUIDs', ids),
});

const keyword: Codec<Keyword> = element<Keyword>('Keyword', {
  id: attribute('ID', string),
  title: textChild('Title', string),
  color: textChild('Color', color),
  // Read through the codec when it is used, as it is being defined here.
  children: list('Children', {
    name: 'Keyword',
    read: (found, unknown) => keyword.read(found, unknown),
    write: (item) => keyword.write(item),
  }),
});

const levelTypes = element<LevelTypes>('LevelTypes', {
  folders: list('Folders', textElement('Type', string)),
  containers: list('Containers', textElement('Type', string)),
  files: list('Files', textElement('Type', string)),
});

const sectionTypes = element<SectionTypes>('SectionTypes', {
  definitions: list(
    'TypeDefinitions',
    element<SectionTypeDefinition>('Type', { id: attribute('ID', string), name: text(string) }),
  ),
  levels: child(levelTypes),
});

const labelSettings = element<LabelSettings>('LabelSettings', {
  title: textChild('Title', string),
  defaultId: textChild('DefaultLabelID', string),
  labels: list(
    'Labels',
    element<Label>('Label', {
      id: attribute('ID', string),
      color: optionalAttribute('Color', color),
      name: text(string),
    }),
  ),
});

const statusSettings = element<StatusSettings>('StatusSettings', {
  title: textChild('Title', string),
  defaultId: textChild('DefaultStatusID', string),
  statuses: list(
    'StatusItems',
    element<Status>('Status', { id: attribute('ID', string), name: text(string) }),
  ),
});

const customField = element<CustomField>('MetaDataField', {
  id: attribute('ID', string),
  type: attribute('Type', oneOf('custom field type', CUSTOM_FIELD_TYPES, 'Text')),
  wraps: optionalAttribute('Wraps', yesNo),
  color: optionalAttribute('Color', color),
  align: optionalAttribute('Align', string),
  defaultChecked: optionalAttribute('Default', yesNo),
  dateType: optionalAttribute('DateType', string),
  absolute: optionalAttribute('Absolute', yesNo),
  title: textChild('Title', string),
  dateFormat: optionalTextChild('DateFormat', string),
  listOptions: optionalChild(
    element<ListOptions>('ListOptions', {
      none: attribute('None', string),
      options: repeated(
        element<ListOption>('Option', { id: attribute('ID', string), name: text(string) }),
      ),
    }),
  ),
});

const projectTargets = element<ProjectTargets>('ProjectTargets', {
  notify: attribute('Notify', yesNo),
  draft: child(
    element<DraftTarget>('DraftTarget', {
      type: attribute('Type', string),
      countIncludedOnly: attribute('CountIncludedOnly', yesNo),
      currentCompileGroupOnly: attribute('CurrentCompileGroupOnly', yesNo),
      deadline: attribute('Deadline', string),
      ignoreDeadline: attribute('IgnoreDeadline', yesNo),
      count: text(integer),
    }),
  ),
  session: child(
    element<SessionTarget>('SessionTarget', {
      type: attribute('Type', string),
      countDraftOnly: attribute('CountDraftOnly', yesNo),
      allowNegatives: attribute('AllowNegatives', yesNo),
      nextResetDate: attribute('NextResetDate', string),
      resetType: attribute('ResetType', string),
      resetTime: attribute('ResetTime', string),
      determinedFromDeadline: attribute('DeterminedFromDeadline', yesNo),
      writingDays: attribute('WritingDays', string),
      canWriteOnDeadlineDate: attribute('CanWriteOnDeadlineDate', yesNo),
      count: text(integer),
    }),
  ),
  previousSession: child(
    element<PreviousSession>('PreviousSession', {
      words: attribute('Words', integer),
      characters: attribute('Characters', integer),
      date: attribute('Date', string),
    }),
  ),
});

const writingHistory = element<RecentWritingHistory>('RecentWritingHistory', {
  date: attribute('Date', string),
  draftWordCount: textChild('DraftWordCount', integer),
  draftCharCount: textChild('DraftCharCount', integer),
  otherWordCount: textChild('OtherWordCount', integer),
  otherCharCount: textChild('OtherCharCount', integer),
});

/** Print settings, as the project and its compile formats both hold them. */
export const printSettings = element<PrintSettings>('PrintSettings', {
  paperSize: attribute('PaperSize', listOf(decimal, ',')),
  leftMargin: attribute('LeftMargin', decimal),
  rightMargin: attribute('RightMargin', decimal),
  topMargin: attribute('TopMargin', decimal),
  bottomMargin: attribute('BottomMargin', decimal),
  paperType: attribute('PaperType', string),
  orientation: attribute('Orientation', string),
  horizontalPagination: attribute('HorizontalPagination', string),
  verticalPagination: attribute('VerticalPagination', string),
  scaleFactor: attribute('ScaleFactor', decimal),
  horizontallyCentered: attribute('HorizontallyCentered', yesNo),
  verticallyCentered: attribute('VerticallyCentered', yesNo),
  collates: attribute('Collates', yesNo),
  pagesAcross: attribute('PagesAcross', integer),
  pagesDown: attribute('PagesDown', integer),
});

/** The `.scrivx` file. */
export const scrivxFile = element<Scrivx>('ScrivenerProject', {
  identifier: attribute('Identifier', string),
  version: attribute('Version', string),
  creator: attribute('Creator', string),
  device: attribute('Device', string),
  author: attribute('Author', string),
  modified: attribute('Modified', string),
  modId: attribute('ModID', string),
  binder: list('Binder', binderItem),
  collections: list('Collections', collection),
  keywords: optionalList('Keywords', keyword),
  sectionTypes: child(sectionTypes),
  labelSettings: child(labelSettings),
  statusSettings: child(statusSettings),
  customFields: list('CustomMetaDataSettings', customField),
  projectBookmarks: optionalList('ProjectBookmarks', bookmark),
  targets: child(projectTargets),
  writingHistory: child(writingHistory),
  templateFolderId: optionalTextChild('TemplateFolderUUID', string),
  bookmarksFolderId: optionalTextChild('BookmarksFolderUUID', string),
  autoComplete: optionalList(
    'AutoCompleteList',
    element<Completion>('Completion', { scope: attribute('Scope', string), word: text(string) }),
  ),
  printSettings: child(printSettings),
  externalSyncMap: optionalList(
    'ExternalSyncMap',
    element<SyncItem>('SyncItem', { id: attribute('ID', string), number: text(string) }),
  ),
});

/** The `.scrivx` file, as Scrivener writes it. */
export function writeScrivx(project: Scrivx): string {
  return writeXml(scrivxFile.write(project));
}
