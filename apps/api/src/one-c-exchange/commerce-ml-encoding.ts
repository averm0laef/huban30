// Turns the bytes of an exchange file into text. 1С:УНФ writes UTF-8, but the
// encoding of a CommerceML file is whatever its XML declaration says: older
// 1С configurations and third-party export modules send windows-1251, and a
// file saved by hand may be UTF-16. Reading those as UTF-8 either fails with
// "no root element" or, worse, fills product names with replacement
// characters, so the declared encoding is honoured and an unknown one is
// rejected by name instead of being guessed.

import { CommerceMlParseError } from "./commerce-ml.parser.js";

const ENCODINGS: Record<string, string> = {
  "cp1251": "windows-1251",
  "cp866": "ibm866",
  "ibm866": "ibm866",
  "koi8-r": "koi8-r",
  "utf-16": "utf-16le",
  "utf-16be": "utf-16be",
  "utf-16le": "utf-16le",
  "utf-8": "utf-8",
  "utf8": "utf-8",
  "win-1251": "windows-1251",
  "windows-1251": "windows-1251",
};

const DECLARATION = /^\s*<\?xml[^>]*?\bencoding\s*=\s*["']([^"']{1,40})["']/u;

function byteOrderMark(content: Buffer): string | null {
  if (content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) return "utf-8";
  if (content[0] === 0xff && content[1] === 0xfe) return "utf-16le";
  if (content[0] === 0xfe && content[1] === 0xff) return "utf-16be";
  return null;
}

/** The encoding the file itself names: a byte order mark first, then the XML declaration, UTF-8 otherwise. */
export function detectCommerceMlEncoding(content: Buffer): string {
  const marked = byteOrderMark(content);
  if (marked) return marked;
  // The declaration is ASCII in every supported single-byte encoding and in UTF-8.
  const declared = DECLARATION.exec(content.subarray(0, 256).toString("latin1"))?.[1]?.trim().toLowerCase();
  if (!declared) return "utf-8";
  const encoding = ENCODINGS[declared];
  if (!encoding) throw new CommerceMlParseError(`Кодировка файла «${declared}» не поддерживается; выгружайте в UTF-8 или windows-1251`);
  return encoding;
}

export function decodeCommerceMl(content: Buffer): string {
  // TextDecoder drops the byte order mark itself.
  return new TextDecoder(detectCommerceMlEncoding(content)).decode(content);
}
