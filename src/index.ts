/**
 * The library: read a Scrivener 3 project into models, change them or not, write them back as
 * Scrivener writes them, and compile the project to MultiMarkdown as Scrivener does.
 *
 * - The project (`openProject`): everything its `.scrivx`, styles and compile settings hold, each
 *   written back by its own writer.  Its documents come from a `Documents` source
 *   (`projectDocuments` reads the project's files), each read into markup and written back over
 *   the RTF it came from.
 * - The model (`readModel`): the project, its documents, the compile settings and the format.  The
 *   compile reads only the model, so a changed model compiles as Scrivener would compile the
 *   changed project.
 * - The prepared compile (`prepareCompile`): every section evaluated, as text that keeps its
 *   marks, before `writeCompile` writes it.  Changing it is up to the caller; the output matches
 *   Scrivener only as prepared.
 */
export {
  addItem,
  addTopItem,
  changeItem,
  moveItem,
  canDrop,
  placeAt,
  readNotes,
  replaceNotes,
  setCustomField,
  setItem,
  trashItem,
} from './binder-edit.ts';
export type { BinderPlace, BinderZone, ItemChange, ItemDetailsChange } from './binder-edit.ts';
export { newBinderItem } from './binder-item.ts';
export { createProject, isProjectName } from './new-project.ts';
export { NEW_PROJECT_FORMAT } from './new-project-look.ts';
export {
  checkboxValue,
  isChecked,
  listValueName,
  pickerDate,
  storedDate,
} from './custom-field-values.ts';
export {
  addCustomField,
  giveDefaults,
  listUses,
  newCustomField,
  newLabel,
  newListEntry,
  retypedField,
  setCustomFields,
  setLabels,
  setLabelSettings,
  setStatuses,
  setStatusSettings,
} from './project-lists.ts';
export type { ListUses } from './project-lists.ts';
export { showItem } from './shown-item.ts';
export { keepsText } from './binder-item.ts';
export type { BinderItem, BinderItemType, Bookmark, ItemMetadata } from './binder-item.ts';
export { BoundText } from './bound-text.ts';
export type {
  Binding,
  Deferred,
  Edit,
  HeadingPart,
  HeadingParts,
  LinkEdge,
  LinkWriter,
  ListLine,
  NoteMarker,
  Trimmed,
  WrittenLink,
} from './bound-text.ts';
export {
  compileModel,
  compileWithImages,
  prepareCompile,
  readText,
  writeCompile,
} from './compile.ts';
export type {
  CompiledFileImage,
  CompileOptions,
  PreparedCompile,
  PreparedNote,
} from './compile.ts';
export { compileFiles, fileLinkPath, writeSections } from './compile-files.ts';
export type { CompiledFile, CompiledFiles, CompileFilesOptions } from './compile-files.ts';
export {
  readCompileChoices,
  readFormatChoices,
  setCompileChoices,
  setFormatChoices,
} from './compile-choices.ts';
export type { CompileChoices, FormatCompileChoices } from './compile-choices.ts';
export { listFormats, MULTIMARKDOWN, readFormatFile, writeFormat } from './compile-format.ts';
export { type Files, hexOf, latin1Bytes, latin1Text, newId, textBytes } from './files.ts';
export { NO_SEPARATOR, readFormatDesign } from './format-design.ts';
export {
  duplicateLayoutDesign,
  newLayoutDesign,
  newStyleDesign,
  setFormatDesign,
} from './format-edit.ts';
export type { FormatDesign, LayoutDesign, SeparatorsDesign, StyleDesign } from './format-design.ts';
export {
  addFormatStyle,
  addMissingStyles,
  addProjectStyle,
  deleteFormat,
  duplicateFormat,
  setSectionTypes,
  setStyleBox,
  setStyleShortcut,
} from './format-manage.ts';
export type { SectionTypesDesign } from './format-manage.ts';
export { markdownTree, treeMarkdown } from './markdown-tree.ts';
export { type FileChanges, type MemoryFiles, memoryFiles } from './memory-files.ts';
export type {
  CompileFormat,
  FormatFile,
  FormatSource,
  FormatStyle,
  FoundFormat,
} from './compile-format.ts';
export type { CompileFilter, CompileSettings, FormatAssignment } from './compile-settings.ts';
export { writeCompileXml } from './compile-xml.ts';
export type {
  CompileXml,
  FormatChoices,
  MetadataValue,
  ProjectCompileSettings,
} from './compile-xml.ts';
export {
  documentRichText,
  keptDocuments,
  projectDocuments,
  readDocumentText,
  writeComments,
} from './document.ts';
export type { Comment, DocumentPart, Documents, DocumentText } from './document.ts';
export type { RtfListItem } from './grouping.ts';
export { markupText } from './markup.ts';
export type { LinkTarget } from './link-target.ts';
export type { Formatted, MarkupNode, PlaceholderNode, StyleMarker } from './markup.ts';
export { readModel } from './model.ts';
export type { CompileInput, ScrivenerModel } from './model.ts';
export { plainLook } from './plain-look.ts';
export type { PlainLook } from './plain-look.ts';
export { placeholderText } from './placeholder-syntax.ts';
export type { Placeholder, PlaceholderPart, TextPart } from './placeholder-syntax.ts';
export {
  adaptiveTitle,
  derivedTitle,
  draftFolder,
  findItem,
  flatten,
  indexBinder,
  labelName,
  NONE_ID,
  projectName,
  sectionTypeName,
  statusName,
  openProject,
  styleName,
} from './project.ts';
export type { BinderIndex, Project, ProjectUnsupported } from './project.ts';
export { insertParagraphs, removeParagraphs, setParagraphStyle } from './edit.ts';
export { listKind } from './edit-lists.ts';
export { EditError, readParagraphs } from './edit-pieces.ts';
export type { Inline, NewParagraph, NoteKind, ReadParagraph } from './edit-pieces.ts';
export { replaceInlines, replaceNoteText, replaceRange, replaceText } from './edit-text.ts';
export { shapeTable } from './edit-tables.ts';
export type { TableParagraph, TableShape } from './edit-tables.ts';
export type { EditingModel } from './editable.ts';
export {
  applyEdits,
  itemMarkdown,
  mapItemMarkdown,
  readEditable,
  readForEditing,
} from './editable.ts';
export { paragraphEdits, shownPiece } from './paragraph-edits.ts';
export { markdownParagraphs, paragraphBlocks, paragraphsMarkdown } from './markdown-form.ts';
export { shownParagraphs } from './item-forms.ts';
export { matches } from './diff.ts';
export { linkAddress, linkTarget } from './link-target.ts';
export type { MarkStyles, WrittenParagraph } from './paragraph-edits.ts';
export { alignParagraphs, alignWords } from './align.ts';
export { plainText } from './text-compare.ts';
export type { AlignedLine, WordHunk } from './align.ts';
export { binderPlaces, compareBinders } from './binder-compare.ts';
export type { BinderChange, FieldChange, ItemPlace, ProjectVersion } from './binder-compare.ts';
export { compareDocument } from './document-compare.ts';
export type {
  Changed,
  ChangedLine,
  CommentChange,
  DocumentComparison,
  DocumentLine,
  NoteChange,
  TextLook,
  TextLookChange,
  WordChange,
} from './document-compare.ts';
export { composeEdits, documentEdits, makeEdits, reverseEdits } from './document-edits.ts';
export { mergeDocument } from './document-merge.ts';
export type { Choose, MergedDocument } from './document-merge.ts';
export { rebaseEdits } from './edit-rebase.ts';
export type { ConflictReason, EditConflict, Rebased, Ties } from './edit-rebase.ts';
export type { DocumentStretch } from './edit-stretch.ts';
export { compareProjects } from './project-compare.ts';
export type {
  DocumentChange,
  FormatChange,
  ProjectComparison,
  StyleChange,
  SynopsisChange,
} from './project-compare.ts';
export { applyProjectEdits, projectEdits } from './project-edits.ts';
export type { ProjectEdit, ProjectSettings } from './project-edits.ts';
export { mergeProjects } from './project-merge.ts';
export type { MergeConflict, MergedProject } from './project-merge.ts';
export { mergeScrivx, mergeScrivxText } from './scrivx-merge.ts';
export type { BinderConflict, MergedScrivx, ScrivxConflict } from './scrivx-merge.ts';
export type { ValueChange, ValueConflict } from './value-compare.ts';
export { ingestMarkdown } from './ingest.ts';
export type { Ingested } from './ingest.ts';
export { readPlist, writePlist } from './plist.ts';
export type { PlistScalar, PlistValue } from './plist.ts';
export {
  readBinderBackup,
  readProjectFiles,
  writeBinderBackup,
  writeProjectFiles,
} from './project-files.ts';
export type { ProjectFiles } from './project-files.ts';
export { struckOut } from './struck-text.ts';
export { addSnapshot, readSnapshots, snapshotFile, snapshotText } from './snapshots.ts';
export type { Snapshot } from './snapshots.ts';
export type {
  DocumentEdit,
  Editable,
  EditableDocument,
  ItemEdit,
  MappedEdits,
} from './editable.ts';
export { MarkdownError, markdownLines, readMarkdown, writeMarkdown } from './markdown-tree.ts';
export {
  type MarkdownRead,
  readBlocks,
  readMarkdownParts,
  rereadMarkdown,
} from './markdown-parts.ts';
export type { Atom, Block, TextBlock } from './markdown-tree.ts';
export { mapEdits } from './map-markdown.ts';
export { mapStructured } from './map-structured.ts';
export type { EditedDocument, EditedParagraph } from './map-structured.ts';
export { findItems, findText, parseSelector, SelectorError } from './selector.ts';
export type { ItemSelector, Selector, TextPlace, TextSelector } from './selector.ts';
export { styleLook, writeStyles } from './project-styles.ts';
export type { ProjectStyle, StyleLook } from './project-styles.ts';
export type { Replacement } from './replacements.ts';
export { shapeOfStyle, styleMapping, styleOfShape, styleRoles } from './style-mapping.ts';
export type { BlockShape, ChosenRoles, StyleMapping, StyleRoles } from './style-mapping.ts';
export type {
  Alignment,
  Border,
  Borders,
  CharacterFormat,
  Color,
  DocumentSettings,
  Font,
  Formatting,
  ListDefinition,
  ListLevel,
  ListOverride,
  ParagraphFormat,
  RichDocument,
  RichParagraph,
  Run,
  TableCell,
  TableRow,
  TabStop,
} from './rich-text.ts';
export { LINE_BREAK, same } from './rich-text.ts';
export { readRichText } from './rich-text-reader.ts';
export { rewriteRichText } from './rich-text-rewrite.ts';
export { writeRichText } from './rich-text-writer.ts';
export { saveProject } from './save.ts';
export type { ItemDocumentsChange, ProjectChanges, SaveResult } from './save.ts';
export type { Scrformat } from './scrformat.ts';
export type { FormatStyleModel, SectionLayoutModel } from './scrformat-layouts.ts';
export type {
  CustomField,
  CustomFieldType,
  Label,
  LabelSettings,
  ListOption,
  Scrivx,
  Status,
  StatusSettings,
} from './scrivx.ts';
export type { PreparedSection } from './section.ts';
export type { SectionLayout, Separators, TitleOptions } from './section-layout.ts';
export { projectStructure } from './structure.ts';
export { isProjectFile, isProjectFolder } from './project.ts';
export { readLayout } from './section-layout.ts';
export { OPEN_IN_SCRIVENER, scrivenerMayHaveIt } from './save.ts';
export type { StructureItem } from './structure.ts';
export { UnsupportedError } from './unsupported.ts';
export type { Unread } from './xml-codec.ts';
