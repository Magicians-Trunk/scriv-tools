/** A browser has no disk to fall back on: a project there opens from files it was given. */
import type { Files } from './files.ts';

const refuse = (): never => {
  throw new Error('A browser has no disk: open the project with its files.');
};

export const localFiles: Files = {
  exists: refuse,
  isDirectory: refuse,
  list: refuse,
  read: refuse,
  write: refuse,
  remove: refuse,
};
