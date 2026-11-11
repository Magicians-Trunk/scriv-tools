/**
 * What the library needs from wherever a project's files are: the disk for the CLI, or memory in a
 * browser.  It reads and writes at once, so a project in a browser is loaded whole, and what
 * changed goes back to the user's folder afterwards.
 */
export interface Files {
  exists(file: string): boolean;
  isDirectory(file: string): boolean;
  /** The names in a folder. */
  list(folder: string): string[];
  read(file: string): Uint8Array;
  /** Writes a file, making the folders it needs. */
  write(file: string, bytes: Uint8Array): void;
  /** Removes a file, if it is there. */
  remove(file: string): void;
  /** Where Scrivener keeps its own compile formats, on a machine that has it. */
  machine?(): { home: string; app?: string | undefined };
}

/** Decodes as the disk holds it: a byte-order mark stays, so a file writes back as it was. */
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

/** A file's text, as UTF-8. */
export const readText = (files: Files, file: string): string => utf8.decode(files.read(file));

/** Text as UTF-8 bytes. */
export const textBytes = (text: string): Uint8Array => encoder.encode(text);

/** A new ID, as Scrivener writes them. */
export const newId = () => crypto.randomUUID().toUpperCase();

/** Windows' code page, which reads as Latin-1 does but for the bytes 0x80 to 0x9F. */
const windows1252 = new TextDecoder('windows-1252');

/**
 * Latin-1 is one byte a character, which `TextDecoder` does not offer: its `latin1` is Windows'.
 * Bytes with none of the characters the two read differently go through the decoder.
 */
export function latin1Text(bytes: Uint8Array): string {
  if (!bytes.some((byte) => byte >= 0x80 && byte < 0xa0)) return windows1252.decode(bytes);
  const CHUNK = 8192;
  let text = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return text;
}

/** Text as Latin-1 bytes. */
export function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at);
  return bytes;
}

/** Bytes as lowercase hexadecimal, as RTF holds a picture. */
export const hexOf = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Hexadecimal as bytes. */
export const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from({ length: Math.floor(hex.length / 2) }, (_, at) =>
    Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16),
  );
