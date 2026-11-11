/** A binder item, as the `.scrivx` file holds it: its metadata, view settings and children. */
import { newId } from './files.ts';
import { dateStamp } from './dates.ts';
import {
  attribute,
  closedWhenEmpty,
  type Codec,
  decimal,
  element,
  integer,
  list,
  listOf,
  mapField,
  oneOf,
  optionalAttribute,
  optionalChild,
  optionalList,
  optionalTextChild,
  string,
  text,
  textChild,
  textElement,
  yesNo,
} from './xml-codec.ts';

/** A binder item's kind: the three top folders, a folder, a text document, a PDF, or other media. */
export type BinderItemType =
  | 'DraftFolder'
  | 'ResearchFolder'
  | 'TrashFolder'
  | 'Folder'
  | 'Text'
  | 'PDF'
  | 'Other';

/** A link from an item, or the project, to another item: its bookmarks. */
export interface Bookmark {
  /** The item it links to; missing for a link out of the project. */
  binderId?: string;
  /** A web address the link goes to. */
  destination?: string;
  /** The bookmark's title, when it has one; `''` when not. */
  title: string;
}

/** The section type chosen for an item by hand, and the one for its subdocuments. */
export interface ItemSectionType {
  /** `''` when the item's own type follows the structure. */
  id: string;
  /** The section type its subdocuments take unless set by hand. */
  childDefault?: string;
}

/** An item's metadata. */
export interface ItemMetadata {
  sectionType?: ItemSectionType;
  labelId?: string;
  statusId?: string;
  includeInCompile?: boolean;
  /** The selection in the item's notes: where it starts, and how long it is. */
  notesTextSelection?: number[];
  iconFileName?: string;
  /** A media item's file extension. */
  fileExtension?: string;
  /** Custom metadata values, by field ID. */
  custom: Record<string, string>;
}

/** How a media item was last shown. */
export interface MediaSettings {
  /** The PDF page last shown, from 0. */
  currentPdfPage?: number;
}

/** A writing target. */
export interface Target {
  type: string;
  notify: boolean;
  showOverrun?: boolean;
  count: number;
}

/** How the item's text was last shown: the selection, and its target. */
export interface TextSettings {
  /** The selection: where it starts, and how long it is. */
  textSelection: number[];
  target?: Target;
}

/** An index card placed by hand on a freeform corkboard. */
export interface IndexCard {
  /** Where the card is, as fractions of the corkboard. */
  position: number[];
  timeStamp: string;
  binderId: string;
}

export interface CorkboardSettings {
  arrangement: string;
  freeformDocuments?: IndexCard[];
}

/** How the item was last shown as a corkboard or outline. */
export interface CorkboardAndOutliner {
  selectedSubdocumentIds?: string[];
  /** The subdocuments shown expanded in the outliner. */
  expandedIds?: string[];
  corkboard?: CorkboardSettings;
}

/** A binder item, from the `.scrivx` file. */
export interface BinderItem {
  id: string;
  type: BinderItemType;
  /** When the item was created and last modified, as Scrivener stores them: `2026-10-31 01:13:04 -0400`. */
  created: string;
  modified: string;
  /** The binder title.  Missing when the item is untitled. */
  title?: string;
  /** How the item's subdocuments are shown when it is selected. */
  groupMode?: string;
  binderSeparator?: boolean;
  metadata?: ItemMetadata;
  mediaSettings?: MediaSettings;
  textSettings?: TextSettings;
  corkboardAndOutliner?: CorkboardAndOutliner;
  /** The IDs of the item's keywords. */
  keywords: string[];
  bookmarks: Bookmark[];
  /** The document template new subdocuments are made from. */
  defaultChildTemplateId?: string;
  children: BinderItem[];
}

const BINDER_ITEM_TYPES: readonly BinderItemType[] = [
  'DraftFolder',
  'ResearchFolder',
  'TrashFolder',
  'Folder',
  'Text',
  'PDF',
  'Other',
];

/** Whether an item of this kind keeps its text in `content.rtf`: a PDF or other media keeps a file of its own. */
export const keepsText = (type: BinderItemType) => type !== 'PDF' && type !== 'Other';

/** Binder IDs, written with commas between them. */
export const ids = listOf(string, ',');

export const bookmark = element<Bookmark>('Bookmark', {
  binderId: optionalAttribute('BinderUUID', string),
  destination: optionalAttribute('Destination', string),
  title: closedWhenEmpty(string),
});

const metadataItem = element<{ field: string; value: string }>('MetaDataItem', {
  field: textChild('FieldID', string),
  value: textChild('Value', string),
});

const metadata = element<ItemMetadata>('MetaData', {
  sectionType: optionalChild(
    element<ItemSectionType>('SectionType', {
      childDefault: optionalAttribute('ChildDefault', string),
      id: text(string),
    }),
  ),
  labelId: optionalTextChild('LabelID', string),
  statusId: optionalTextChild('StatusID', string),
  includeInCompile: optionalTextChild('IncludeInCompile', yesNo),
  notesTextSelection: optionalTextChild('NotesTextSelection', listOf(integer, ',')),
  iconFileName: optionalTextChild('IconFileName', string),
  fileExtension: optionalTextChild('FileExtension', string),
  custom: mapField(
    list('CustomMetaData', metadataItem),
    (items) => Object.fromEntries(items.map(({ field, value }) => [field, value])),
    (values) => Object.entries(values).map(([field, value]) => ({ field, value })),
  ),
});

const mediaSettings = element<MediaSettings>('MediaSettings', {
  currentPdfPage: optionalTextChild('CurrentPDFPage', integer),
});

const textSettings = element<TextSettings>('TextSettings', {
  textSelection: textChild('TextSelection', listOf(integer, ',')),
  target: optionalChild(
    element<Target>('Target', {
      type: attribute('Type', string),
      notify: attribute('Notify', yesNo),
      showOverrun: optionalAttribute('ShowOverrun', yesNo),
      count: text(integer),
    }),
  ),
});

const corkboardAndOutliner = element<CorkboardAndOutliner>('CorkboardAndOutliner', {
  selectedSubdocumentIds: optionalTextChild('SelectedSubdocumentUUIDs', ids),
  expandedIds: optionalList('OutlinerExpandedState', textElement('ItemID', string)),
  corkboard: optionalChild(
    element<CorkboardSettings>('CorkboardSettings', {
      arrangement: textChild('Arrangement', string),
      freeformDocuments: optionalList(
        'FreeformCorkboardDocuments',
        element<IndexCard>('IndexCardBinderUUID', {
          position: attribute('Position', listOf(decimal, ',')),
          timeStamp: attribute('TimeStamp', string),
          binderId: text(string),
        }),
      ),
    }),
  ),
});

export const binderItem: Codec<BinderItem> = element<BinderItem>('BinderItem', {
  id: attribute('UUID', string),
  type: attribute('Type', oneOf('binder item type', BINDER_ITEM_TYPES, 'Other')),
  created: attribute('Created', string),
  modified: attribute('Modified', string),
  title: optionalTextChild('Title', string),
  groupMode: optionalTextChild('GroupMode', string),
  binderSeparator: optionalTextChild('BinderSeparator', yesNo),
  metadata: optionalChild(metadata),
  mediaSettings: optionalChild(mediaSettings),
  textSettings: optionalChild(textSettings),
  corkboardAndOutliner: optionalChild(corkboardAndOutliner),
  keywords: list('Keywords', textElement('KeywordID', string)),
  bookmarks: list('Bookmarks', bookmark),
  defaultChildTemplateId: optionalTextChild('DefaultChildTemplateUUID', string),
  // Read through the codec when it is used, as it is being defined here.
  children: list('Children', {
    name: 'BinderItem',
    read: (found, unknown) => binderItem.read(found, unknown),
    write: (item) => binderItem.write(item),
  }),
});

/**
 * A new binder item, as Scrivener makes one: a fresh ID, created and modified now, included in
 * the compile, and a text's selection at its start.
 */
export function newBinderItem(type: BinderItemType, title?: string, now = new Date()): BinderItem {
  const stamp = dateStamp(now);
  const item: BinderItem = {
    id: newId(),
    type,
    created: stamp,
    modified: stamp,
    metadata: { includeInCompile: true, custom: {} },
    keywords: [],
    bookmarks: [],
    children: [],
  };
  if (title !== undefined) item.title = title;
  if (!type.endsWith('Folder')) item.textSettings = { textSelection: [0, 0] };
  return item;
}
