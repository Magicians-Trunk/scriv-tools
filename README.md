# scriv-tools
Reads, edits and compiles Scrivener 3 projects.  Its compile writes MultiMarkdown as Scrivener's own MultiMarkdown compile writes it, so a project compiles with no Scrivener installed, or open.
## Installing
```
npm install scriv-tools
```
The package holds the `scriv-tools` command and the library.  `npx scriv-tools --help` lists the commands, and `--help` after a command shows its options.
## The Command Line
Every command but `new` takes the project first: the `.scriv` folder, or the `.scrivx` file inside it.  The commands that work on items name them with a selector: `id:<ID>`, `path:<binder path>` or `field:<field ID>=<value>`, then, to narrow to part of the items, `heading:<text>` for a section or `text:<text>` for paragraphs.

* new - Creates a blank project, with styles and a compile format of its own.
* compile - Compiles the Draft folder with a compile format, the one last used unless another is named, to the screen or to a file, with its images beside the file.
* structure - Shows the binder as JSON.
* read - Shows one document's text, as the compile would write it.
* find - Lists the items a selector names, with their IDs, binder paths and titles.
* export - Writes items to a Markdown file and a JSON file to edit.  Markdown is for text, headings, lists, quotes and code, and the JSON form, each item's paragraphs as typed data, is for everything else.  After each item's own words comes its compiled text, read only, so the edit shows what the compile will make of it.
* import - Takes an edited export back into its items and saves them.  It writes nothing if any change cannot be made, and refuses an item whose compiled text was changed.
* ingest - Takes a Markdown file or folder in under an item.  A file updates its item, changing only what differs, or becomes a new one, and a folder becomes a folder.
* files - Shows the project's other files as JSON.
* snapshots - Shows an item's snapshots, and can take a new one first.
* add - Adds a text or a folder under an item.
* move - Moves an item under another.
* trash - Moves an item to the Trash.
* set - Changes an item's title, synopsis, notes, label, status, section type, a custom field, or whether the compile includes it.  Only what is given changes.
* formats - Lists the compile formats it can find.

## The Library
The same package is a TypeScript library.  It reads a project into typed models: the binder, the documents, the styles, the compile settings and the compile format.  A program can change them and save them back as Scrivener writes them, and only the files that changed are written.  Every file is made before any is written, so a save that cannot be made writes nothing.  The compile reads only the models, so changed models compile as Scrivener would compile the changed project.
## While Scrivener Has the Project Open
Scrivener keeps an open project in memory, and can save over changes made beside it.  It leaves a lock in the project while it has it open, and every command that saves warns of the lock, then saves.  Close the project in Scrivener before changing it.
## License
Apache-2.0.
