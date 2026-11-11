import { defineConfig } from 'vite-plus';
import { checkTasks } from '@magicians/config/check-tasks';
import { fmt } from '@magicians/config/fmt';
import { lint } from '@magicians/config/lint';

/** This package's checks, as Vite Tasks cached on what they read, and its lint and format rules. */
export default defineConfig({
  lint,
  fmt: {
    ...fmt,
    // Written by Scrivener; the compiled output must stay byte for byte.
    ignorePatterns: [...fmt.ignorePatterns, 'test/fixtures/'],
  },
  run: {
    tasks: checkTasks(import.meta.dirname, {
      build: 'tsc -p tsconfig.build.json',
      typecheck: 'tsc -p .',
      // Compiling whole fixture projects, under coverage and side by side, can pass the default 5s.
      test: 'vp test run --coverage --testTimeout=20000',
      lint: 'vp lint',
    }),
  },
});
