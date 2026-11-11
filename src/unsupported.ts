import { type Unread, unreadList } from './xml-codec.ts';

/**
 * A project or compile format uses something the CLI does not implement yet.  The CLI stops and
 * names it, and never approximates a compile.
 */
export class UnsupportedError extends Error {
  constructor(feature: string) {
    super(`Unsupported: ${feature}`);
    this.name = 'UnsupportedError';
  }
}

/**
 * Refuses to write a file that was read with something the library does not know: written from
 * the model, the file would lose it.
 */
export function refuseUnknown(file: string, unread: Unread): void {
  const found = unreadList(unread);
  if (found.length > 0)
    throw new UnsupportedError(`writing ${file}, which holds ${found.join(', ')}`);
}

/** Stops a compile on what a file holds that the library does not know, which could change it. */
export function stopOnUnknown(file: string, { unknown }: Unread): void {
  if (unknown.size > 0) throw new UnsupportedError(`${file} holding ${[...unknown].join(', ')}`);
}
