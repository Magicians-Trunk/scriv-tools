/** The disk, where Node runs the library. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Files } from './files.ts';

export const localFiles: Files = {
  exists: (file) => fs.existsSync(file),
  isDirectory: (file) => fs.statSync(file).isDirectory(),
  list: (folder) => fs.readdirSync(folder),
  read: (file) => fs.readFileSync(file),
  write(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  },
  remove: (file) => fs.rmSync(file, { force: true }),
  machine: () => ({ home: os.homedir(), app: process.env.SCRIVENER_APP }),
};
