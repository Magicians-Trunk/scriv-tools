/** Struck-through text, which the compile deletes when its options say to. */
import {
  type Formatted,
  isSpan,
  markupRuns,
  type MarkupNode,
  parseMarkup,
  writtenText,
} from './markup.ts';
import { type CharacterFormat, same } from './rich-text.ts';

/** Whether formatting strikes its text through. */
function isStruck(format: CharacterFormat): boolean {
  return format.strike !== undefined && format.strike.style !== 'none';
}

/** Whether all of something written is struck through. */
function allStruck({ format, mixed }: Formatted): boolean {
  return mixed ? mixed.every((part) => isStruck(part.format)) : isStruck(format);
}

/**
 * Markup with its struck-through text deleted, as the compile deletes it when its options say
 * to: markup struck through goes too, and a span whose ends are struck through leaves its text
 * in place.
 */
export function struckOut(nodes: MarkupNode[]): MarkupNode[] {
  const kept: MarkupNode[] = [];
  const keep = (node: MarkupNode) => {
    const last = kept.at(-1);
    if (node.kind === 'text' && last?.kind === 'text') last.text += node.text;
    else kept.push(node.kind === 'text' ? { ...node } : node);
  };
  for (const node of nodes) {
    if (node.kind === 'link') keep({ ...node, content: struckOut(node.content) });
    else if (isSpan(node)) {
      const content = struckOut(node.content);
      if (node.open && node.close && allStruck(node.open) && allStruck(node.close)) {
        content.forEach(keep);
      } else keep({ ...node, content });
    } else if (!('format' in node) || !allStruck(node)) keep(node);
  }
  return kept;
}

/**
 * Whether deleting the struck-through text of `content` before reading its markup, as
 * Scrivener does, reads differently from deleting it from the markup read with it: strike-through
 * that cuts across Scrivener's markup.
 */
export function struckChangesMarkup(nodes: MarkupNode[]): boolean {
  const runs = markupRuns(nodes);
  if (!runs.some((run) => isStruck(run.format))) return false;
  const kept = runs.filter((run) => !isStruck(run.format));
  return !same(writtenForm(parseMarkup(kept)), writtenForm(struckOut(nodes)));
}

/** Markup as the compile reads it, its text written out and formatting aside, to compare. */
function writtenForm(nodes: MarkupNode[]): unknown[] {
  const form = (list: MarkupNode[]): unknown[] => {
    const out: unknown[] = [];
    for (const node of list) {
      const text = writtenText(node);
      const last = out.at(-1);
      if (text !== undefined) {
        if (typeof last === 'string') out[out.length - 1] = last + text;
        else out.push(text);
      } else if (node.kind === 'link')
        out.push({ kind: 'link', target: node.target, content: form(node.content) });
      else if ('content' in node) out.push({ kind: node.kind, content: form(node.content) });
      else out.push({ kind: node.kind, source: 'source' in node ? node.source : '' });
    }
    return out;
  };
  return form(nodes);
}
