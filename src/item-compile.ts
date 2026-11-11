/**
 * Each item's text as the compile writes it, cut from the real compile's output, for a form to
 * show beside the item's own words.  It is reference only: a seal says whether it is still as
 * the compile wrote it, so that reading a form back can refuse an item whose compiled text
 * changed.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { type CompileOptions, prepareCompile, writeMarked } from './compile.ts';
import { readModel } from './model.ts';
import type { Project } from './project.ts';
import { UnsupportedError } from './unsupported.ts';

/**
 * What the compile writes for an item: its pieces of the output in order (its section, then any
 * suffix after its subdocuments and its footnotes), sealed; or that it writes none.
 */
export type CompiledText =
  | { kind: 'text'; pieces: string[]; seal: string }
  | { kind: 'left out' }
  | { kind: 'stopped' };

/** The compile's text of every item it writes, by binder ID, or what stopped it. */
export type ItemCompiles = { pieces: Map<string, string[]> } | { stopped: string };

/** The seal of an item's compiled pieces, which changes with any change to them. */
export const sealOf = (pieces: string[]): string =>
  bytesToHex(sha256(utf8ToBytes(JSON.stringify(pieces))));

/**
 * Compiles a project once, as `compile` does, with the format named or the one last used, and
 * cuts its output into each item's text.  It is reference only, so a format that cannot be read
 * stops only this.
 */
export function itemCompiles(
  project: Project,
  format?: string,
  options: CompileOptions = {},
): ItemCompiles {
  let model;
  try {
    model = readModel(project, format);
  } catch (error) {
    return { stopped: error instanceof Error ? error.message : String(error) };
  }
  try {
    return { pieces: writeMarked(prepareCompile(model, options)).sections() };
  } catch (error) {
    if (!(error instanceof UnsupportedError)) throw error;
    return { stopped: error.message };
  }
}

/** What the compile writes for one item. */
export function compiledText(compiles: ItemCompiles, item: string): CompiledText {
  if ('stopped' in compiles) return { kind: 'stopped' };
  const pieces = compiles.pieces.get(item);
  return pieces ? { kind: 'text', pieces, seal: sealOf(pieces) } : { kind: 'left out' };
}

/**
 * Why a form's compiled text for an item stops it being read back: it has none, or it is not as
 * the compile wrote it.  Nothing when it is as written.
 */
export function compiledChange(compiled: CompiledText | undefined): string | undefined {
  if (!compiled) {
    return 'It has no compiled text: export writes it for every item, and import needs it as written.';
  }
  if (compiled.kind !== 'text' || sealOf(compiled.pieces) === compiled.seal) return undefined;
  return "Its compiled text is not as export wrote it.  The compiled text is reference only: change the item's own words instead.";
}
