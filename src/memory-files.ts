import type { Files } from './files.ts';

/** What changed in memory since it was last asked: the files to write, and those to remove. */
export interface FileChanges {
  written: Map<string, Uint8Array>;
  removed: Set<string>;
}

/** Files held in memory, which keep track of what changed so it can go back where it came from. */
export interface MemoryFiles extends Files {
  /** Every file held, by its path. */
  all(): ReadonlyMap<string, Uint8Array>;
  /** What changed since this was last called. */
  takeChanges(): FileChanges;
}

/** What every path inside a folder starts with. */
const inside = (folder: string) => `${folder.replace(/\/+$/, '')}/`;

/** Files in memory, from each file's path and bytes. */
export function memoryFiles(entries: Iterable<readonly [string, Uint8Array]> = []): MemoryFiles {
  const held = new Map(entries);
  let changes: FileChanges = { written: new Map(), removed: new Set() };
  const namesIn = (folder: string) => {
    const start = inside(folder);
    return [...held.keys()]
      .filter((file) => file.startsWith(start))
      .map((file) => file.slice(start.length).split('/')[0]!);
  };
  return {
    exists: (file) => held.has(file) || namesIn(file).length > 0,
    isDirectory: (file) => !held.has(file) && namesIn(file).length > 0,
    list: (folder) => [...new Set(namesIn(folder))],
    read(file) {
      const bytes = held.get(file);
      if (!bytes) throw new Error(`No such file: ${file}`);
      return bytes;
    },
    write(file, bytes) {
      held.set(file, bytes);
      changes.written.set(file, bytes);
      changes.removed.delete(file);
    },
    remove(file) {
      if (held.delete(file)) changes.removed.add(file);
      changes.written.delete(file);
    },
    all: () => held,
    takeChanges() {
      const taken = changes;
      changes = { written: new Map(), removed: new Set() };
      return taken;
    },
  };
}
