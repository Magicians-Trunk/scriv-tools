/** Where links point, and how a link's field and address write that. */
/** Where a link points: another binder item, a linked comment, or an address. */
export type LinkTarget =
  | { kind: 'document'; id: string }
  | { kind: 'comment'; id: string }
  | { kind: 'address'; address: string };

/** The target of a `HYPERLINK "…"` field instruction; nothing for other fields. */
export function hyperlinkTarget(instruction: string): string | undefined {
  return /^\s*HYPERLINK\s+"([^"]*)"/.exec(instruction)?.[1];
}

/** Link targets for a linked comment and for another binder item. */
const COMMENT_LINK = 'scrivcmt://';

const DOCUMENT_LINK = 'scrivlnk://';

/** Where a link goes, as its field and a Markdown link write it. */
export function linkAddress(target: LinkTarget): string {
  if (target.kind === 'document') return `${DOCUMENT_LINK}${target.id}`;
  if (target.kind === 'comment') return `${COMMENT_LINK}${target.id}`;
  return target.address;
}

/** The field instruction of a link to a target. */
export function linkField(target: LinkTarget): string {
  return `HYPERLINK "${linkAddress(target)}"`;
}

/** Reads a link's address once, by its scheme. */
export function linkTarget(target: string): LinkTarget {
  if (target.startsWith(DOCUMENT_LINK)) {
    return { kind: 'document', id: target.slice(DOCUMENT_LINK.length) };
  }
  if (target.startsWith(COMMENT_LINK)) {
    return { kind: 'comment', id: target.slice(COMMENT_LINK.length) };
  }
  return { kind: 'address', address: target };
}
