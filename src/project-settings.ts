/** The small settings files beside a project: its preferences, favourites, template and sync. */
import { rtfText } from './document.ts';
import {
  attribute,
  closedWhenEmpty,
  element,
  integer,
  list,
  optionalAttribute,
  optionalChild,
  optionalTextChild,
  repeated,
  string,
  text,
  textChild,
  yesNo,
} from './xml-codec.ts';

const version = attribute('Version', string);

/** `Settings/projectpreferences.xml`: the formatting a project keeps for itself. */
export const preferencesFile = element('ProjectPreferences', {
  version,
  useProjectPreferences: optionalTextChild('UseProjectPreferences', yesNo),
  textFormat: optionalTextChild('TextFormatRTFData', rtfText, true),
  useCustomFootnotesFont: optionalTextChild('UseCustomFootnotesFont', yesNo),
  footnotesFont: optionalChild(
    element('FootnotesFont', { size: attribute('Size', string), name: text(string) }),
  ),
  footnoteMarker: optionalChild(
    element('FootnoteMarker', { useMarker: attribute('UseMarker', yesNo), marker: text(string) }),
  ),
});

/** An item a menu offers, and how it was used. */
const favourite = element('UUID', {
  used: optionalAttribute('Used', integer),
  date: attribute('Date', string),
  item: text(string),
});

/** The recent and most used items of one menu. */
const favourites = (name: string) =>
  element(name, { recent: list('Recent', favourite), popular: list('Popular', favourite) });

/** `Settings/favorites.xml`: what the "Move To" and "Append" menus put first. */
export const favoritesFile = element('Favorites', {
  version,
  moveTo: optionalChild(favourites('MoveTo')),
  append: optionalChild(favourites('Append')),
});

/** `Settings/templateinfo.xml`: what a project made as a template says of itself. */
export const templateInfoFile = element('TemplateSettings', {
  version,
  title: textChild('Title', string),
  category: textChild('Category', string),
  customImage: optionalChild(
    element('CustomImageData', { type: attribute('Type', string), data: text(string) }),
  ),
});

/** A setting written with its type: `Bool`, `String` or `Int`. */
const synced = (name: string) =>
  element(name, { type: attribute('Type', string), value: closedWhenEmpty(string) });

const syncSetting = (name: string) => optionalChild(synced(name));

/** `Settings/User/folder-sync.settings`: Sync with External Folder. */
export const folderSyncFile = element('FolderSyncSettings', {
  version,
  syncsOnlyDocumentsInCollection: syncSetting('syncsOnlyDocumentsInCollection'),
  takesSnapshots: syncSetting('takesSnapshots'),
  draftPlainTextExtension: syncSetting('draftPlainTextExtension'),
  folderRelPath: syncSetting('folderRelPath'),
  draftFileFormat: syncSetting('draftFileFormat'),
  plainTextAddsParagraphPadding: syncSetting('plainTextAddsParagraphPadding'),
  importShowsContainersOnly: syncSetting('importShowsContainersOnly'),
  usesFileNumbering: syncSetting('usesFileNumbering'),
  folderPath: syncSetting('folderPath'),
  enabled: syncSetting('enabled'),
  automaticallyCheckForChanges: syncSetting('automaticallyCheckForChanges'),
  importDestinationUUID: syncSetting('importDestinationUUID'),
  syncsDraftFolder: syncSetting('syncsDraftFolder'),
  syncsOtherTextFiles: syncSetting('syncsOtherTextFiles'),
  otherFileFormat: syncSetting('otherFileFormat'),
  otherPlainTextExtension: syncSetting('otherPlainTextExtension'),
});

/** A day's writing: words and characters in the draft and elsewhere, and draft totals. */
const day = element('Day', {
  dwc: optionalAttribute('dwc', integer),
  dcc: optionalAttribute('dcc', integer),
  dtwc: optionalAttribute('dtwc', integer),
  owc: optionalAttribute('owc', integer),
  occ: optionalAttribute('occ', integer),
  dtcc: optionalAttribute('dtcc', integer),
  date: text(string),
});

/** `Files/writing.history`: the words written each day. */
export const writingHistoryFile = element('WritingHistory', { days: repeated(day) });
