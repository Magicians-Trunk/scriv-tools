import { BoundText } from './bound-text.ts';
import type { CompileFormat } from './compile-format.ts';
import type { CompileSettings } from './compile-settings.ts';
import type { BinderItem } from './binder-item.ts';
import { UnsupportedError } from './unsupported.ts';

/** The titles of a metadata document, the old spellings included. */
const METADATA_TITLE = /^meta[- ]?data$/i;

/** Whether the compile's first item is a metadata document. */
export function isMetadataDocument(item: BinderItem | undefined): boolean {
  return METADATA_TITLE.test(item?.title ?? '');
}

/**
 * The metadata block: the format's keys, with the project's metadata where the format marks it,
 * followed there by a metadata document's text.  Values go through replacements, then their
 * placeholders (but for `<$title>`, which comes first), as a layout's own text does.  Every key's line but the last ends in two spaces; the document's text goes in
 * as it is, and the block's trailing spaces are trimmed.  Pandoc syntax wraps it in `---` lines
 * and lowercases its keys.
 */
export function metadataBlock(
  format: CompileFormat,
  settings: CompileSettings,
  finish: (text: BoundText) => BoundText,
  documentText?: BoundText,
): BoundText {
  const keyed = ({ key, value }: { key: string; value: string }) => {
    const name = format.usePandocSyntax ? key.toLowerCase() : key;
    // A value is the format's text, whose placeholders wait for the replacements.
    return { line: BoundText.join([`${name}: `, finish(BoundText.deferred(value))]) };
  };
  const document = documentText === undefined ? [] : [{ line: documentText, verbatim: true }];
  if (document.length > 0 && !format.metadata.includes(undefined)) {
    throw new UnsupportedError(
      'a metadata document with a format that leaves out project metadata',
    );
  }
  const lines = format.metadata.flatMap((entry) =>
    entry ? [keyed(entry)] : [...settings.metadata.map(keyed), ...document],
  );
  if (lines.length === 0) return BoundText.of('');
  const block = BoundText.trimmed(
    BoundText.join(
      lines.flatMap(({ line, ...rest }, index) => {
        if (index === lines.length - 1) return [line];
        return [line, 'verbatim' in rest ? '\n' : '  \n'];
      }),
    ),
    'end',
  );
  return format.usePandocSyntax
    ? BoundText.join(['---\n', block, '\n---\n\n'])
    : BoundText.join([block, '\n\n']);
}
