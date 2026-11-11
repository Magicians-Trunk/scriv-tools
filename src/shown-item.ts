/** What Scrivener shows when it opens a project: an item in its editor, chosen in the binder. */
import type { PlistScalar } from './plist.ts';
import type { Project } from './project.ts';
import { readProjectFiles, writeProjectFiles } from './project-files.ts';

/** The `Settings/ui.plist` key that says which item the bookmarks follow. */
const BOOKMARKS = 'bookmarksSelectionInfo';
/** The row of an item with no bookmark chosen, as Scrivener writes it. */
const NOT_IN_A_LIST: PlistScalar = { kind: 'integer', value: '-1' };

/** Makes an item the one a project opens on, with the binder's top folders open to show it. */
export function showItem(
  { binder, dir, files }: Pick<Project, 'binder' | 'dir' | 'files'>,
  id: string,
): void {
  const held = readProjectFiles(dir, files);
  const { uiState, uiPlist } = held;
  const view = uiState?.editors?.editor1?.view;
  if (!uiState?.binder || !view?.navigationHistory || !(uiPlist instanceof Map)) {
    throw new Error(`${dir} keeps no window state.`);
  }
  uiState.binder.expandedItems = binder
    .filter(({ children }) => children.length > 0)
    .map((item) => item.id);
  uiState.binder.selection = [id];
  view.content = [id];
  for (const entry of view.navigationHistory.items) entry.item = id;
  held.recents = [id];
  uiPlist.set(BOOKMARKS, new Map([[id, new Map([['Row', NOT_IN_A_LIST]])]]));
  writeProjectFiles(dir, held, files);
}
