import { describe, expect, it } from 'vite-plus/test';
import { addItem } from './binder-edit.ts';
import { memoryFiles } from './memory-files.ts';
import { createProject } from './new-project.ts';
import { readProjectFiles } from './project-files.ts';
import { showItem } from './shown-item.ts';

describe('showItem', () => {
  it('opens a project on an item, with the folders that hold anything open', () => {
    const files = memoryFiles();
    const project = createProject('/work', 'Shown', files);
    const [draft, research] = project.binder;
    const item = addItem('Text', 'Next', { parent: research! });
    showItem(project, item.id);
    const { recents, uiState, uiPlist } = readProjectFiles(project.dir, files);
    expect(recents).toEqual([item.id]);
    expect(uiState!.binder!.selection).toEqual([item.id]);
    expect(uiState!.binder!.expandedItems).toEqual([draft!.id, research!.id]);
    const view = uiState!.editors!.editor1!.view!;
    expect(view.content).toEqual([item.id]);
    expect(view.navigationHistory!.items.map((entry) => entry.item)).toEqual([item.id]);
    expect(uiPlist).toBeInstanceOf(Map);
  });

  it.each(['Settings/ui.plist', 'Settings/ui-common.xml'])(
    'stops on a project with no %s',
    (file) => {
      const files = memoryFiles();
      const project = createProject('/work', 'Bare', files);
      files.remove(`${project.dir}/${file}`);
      expect(() => showItem(project, 'X')).toThrow('keeps no window state');
    },
  );
});
