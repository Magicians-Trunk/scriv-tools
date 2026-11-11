/**
 * Selectors: what names items in a project, and the text inside them.  Nothing here knows any one
 * project: fields and titles are the caller's.
 */
import type { BinderItem } from './binder-item.ts';
import type { Documents } from './document.ts';
import { headingTagOf, markupText, type MarkupNode } from './markup.ts';
import { adaptiveTitle, flatten, type Project } from './project.ts';

/** Names items: by binder ID, by binder path, or by a custom field's value. */
export type ItemSelector =
  | { kind: 'id'; id: string }
  | { kind: 'path'; path: string }
  | { kind: 'field'; field: string; value: string };

/** Narrows to text inside items: a section by its heading, or paragraphs holding some text. */
export type TextSelector = { kind: 'heading'; text: string } | { kind: 'text'; text: string };

export interface Selector {
  items: ItemSelector;
  within?: TextSelector;
}

/** Paragraphs in an item's text: from `first`, `count` of them. */
export interface TextPlace {
  item: BinderItem;
  first: number;
  count: number;
}

/** A selector that cannot be read, or names nothing. */
export class SelectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectorError';
  }
}

/** The form before a selector's first `:`, and what follows it. */
function parts(selector: string): [string, string] {
  const colon = selector.indexOf(':');
  if (colon < 0) throw new SelectorError(`Not a selector: "${selector}"`);
  return [selector.slice(0, colon), selector.slice(colon + 1)];
}

function parseItems(selector: string): ItemSelector {
  const [form, value] = parts(selector);
  if (form === 'id') return { kind: 'id', id: value };
  if (form === 'path') return { kind: 'path', path: value };
  const equals = value.indexOf('=');
  if (form === 'field' && equals > 0) {
    return { kind: 'field', field: value.slice(0, equals), value: value.slice(equals + 1) };
  }
  throw new SelectorError(`Not a selector of items: "${selector}"`);
}

function parseWithin(selector: string): TextSelector {
  const [form, text] = parts(selector);
  if (form === 'heading' || form === 'text') return { kind: form, text };
  throw new SelectorError(`Not a selector of text: "${selector}"`);
}

/** Reads a selector as written: `id:`, `path:` or `field:<id>=<value>`, then `heading:` or `text:`. */
export function parseSelector([items, within, ...rest]: readonly string[]): Selector {
  if (items === undefined || rest.length > 0) {
    throw new SelectorError('A selector is one item form, then at most one text form.');
  }
  const selector: Selector = { items: parseItems(items) };
  if (within !== undefined) selector.within = parseWithin(within);
  return selector;
}

/** The items at a path below these: a title may hold a `/`, so each is matched whole. */
function atPath(items: BinderItem[], path: string, documents: Documents): BinderItem[] {
  return items.flatMap((item) => {
    const title = adaptiveTitle(item, documents);
    if (path === title) return [item];
    return path.startsWith(`${title}/`)
      ? atPath(item.children, path.slice(title.length + 1), documents)
      : [];
  });
}

/** The items a selector names, in binder order.  Naming none stops. */
export function findItems(
  project: Pick<Project, 'binder'>,
  documents: Documents,
  selector: ItemSelector,
): BinderItem[] {
  const items = flatten(project.binder);
  const found = (): BinderItem[] => {
    switch (selector.kind) {
      case 'id':
        return items.filter((item) => item.id === selector.id);
      case 'path':
        return atPath(project.binder, selector.path, documents);
      default:
        return items.filter((item) => item.metadata?.custom?.[selector.field] === selector.value);
    }
  };
  const named = found();
  if (named.length === 0) throw new SelectorError(`Nothing matches ${JSON.stringify(selector)}`);
  return named;
}

/**
 * Each paragraph's heading level, where its first text is inside a heading's tags.  Tags can open
 * in one paragraph and close in the next, or open and close with no text between.
 */
function headingLevels(paragraphs: { content: MarkupNode[] }[]): (number | undefined)[] {
  let open: number | undefined;
  return paragraphs.map(({ content }) => {
    let level: number | undefined;
    let written = false;
    for (const node of content) {
      const tag = headingTagOf(node);
      if (tag) open = tag.closing ? undefined : tag.level;
      else if (!written && markupText([node]) !== '') {
        written = true;
        level = open;
      }
    }
    return level;
  });
}

/** One item's paragraphs, each with its text and heading level. */
function outline(item: BinderItem, documents: Documents) {
  const { paragraphs } = documents.text(item.id);
  const levels = headingLevels(paragraphs);
  return paragraphs.map(({ content }, index) => ({
    item,
    index,
    text: markupText(content),
    level: levels[index],
  }));
}

/** Runs of neighbouring paragraphs as places, one for each item they are in. */
function placesOf(lines: { item: BinderItem; index: number }[]): TextPlace[] {
  const places: TextPlace[] = [];
  for (const { item, index } of lines) {
    const last = places.at(-1);
    if (last?.item === item && last.first + last.count === index) last.count += 1;
    else places.push({ item, first: index, count: 1 });
  }
  return places;
}

/**
 * The paragraphs a text selector names in these items, taken in order as one text.  A section runs
 * from its heading to the next heading of its level or higher.  Naming none stops.
 */
export function findText(
  items: BinderItem[],
  documents: Documents,
  selector: TextSelector,
): TextPlace[] {
  const lines = items.flatMap((item) => outline(item, documents));
  const found =
    selector.kind === 'text'
      ? lines.filter((line) => line.text.includes(selector.text))
      : lines.flatMap((line, index) => {
          if (line.level === undefined || line.text !== selector.text) return [];
          const after = lines.slice(index + 1);
          const end = after.findIndex(({ level }) => level !== undefined && level <= line.level!);
          return [line, ...(end < 0 ? after : after.slice(0, end))];
        });
  if (found.length === 0) throw new SelectorError(`Nothing matches ${JSON.stringify(selector)}`);
  return placesOf(found);
}
