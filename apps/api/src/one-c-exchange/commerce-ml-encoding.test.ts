import { describe, expect, it } from "vitest";

import { decodeCommerceMl, detectCommerceMlEncoding } from "./commerce-ml-encoding.js";
import { CommerceMlParseError, parseImportXml } from "./commerce-ml.parser.js";

const NAME = "Фильтр масляный «Ёлочка» №5";

const document = (encoding: string | null) => `${encoding ? `<?xml version="1.0" encoding="${encoding}"?>\n` : ""}<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="2026-11-23T10:00:00">
<Классификатор><Ид>c</Ид><Наименование>Классификатор</Наименование></Классификатор>
<Каталог СодержитТолькоИзменения="false"><Ид>cat</Ид><Товары>
<Товар><Ид>g-1</Ид><Артикул>A1</Артикул><Наименование>${NAME}</Наименование></Товар>
</Товары></Каталог></КоммерческаяИнформация>`;

/** Encodes with a single-byte code page by inverting what TextDecoder reads from it. */
function singleByte(text: string, encoding: string): Buffer {
  const decoder = new TextDecoder(encoding);
  const bytes = new Map<string, number>();
  for (let byte = 0; byte < 256; byte += 1) bytes.set(decoder.decode(Uint8Array.of(byte)), byte);
  return Buffer.from([...text].map((character) => {
    const byte = bytes.get(character);
    if (byte === undefined) throw new Error(`${character} is not in ${encoding}`);
    return byte;
  }));
}

const productName = (content: Buffer) => {
  const product = parseImportXml(decodeCommerceMl(content)).bodyRows.find((row) => row.entityType === "product");
  return product?.entityType === "product" ? product.name : undefined;
};

describe("the encoding of a 1С exchange file", () => {
  it("reads UTF-8 with and without a byte order mark", () => {
    const plain = Buffer.from(document("UTF-8"), "utf8");
    expect(productName(plain)).toBe(NAME);
    expect(productName(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), plain]))).toBe(NAME);
    expect(productName(Buffer.from(document(null), "utf8"))).toBe(NAME);
  });

  it("reads a windows-1251 file by its declaration", () => {
    const content = singleByte(document("windows-1251"), "windows-1251");
    expect(content.toString("utf8")).not.toContain("Фильтр");
    expect(detectCommerceMlEncoding(content)).toBe("windows-1251");
    expect(productName(content)).toBe(NAME);
  });

  it("knows the other names 1С modules give the Cyrillic code pages", () => {
    expect(productName(singleByte(document("CP1251"), "windows-1251"))).toBe(NAME);
    expect(productName(singleByte(document("cp866").replaceAll("«", "\"").replaceAll("»", "\""), "ibm866")))
      .toBe(NAME.replaceAll("«", "\"").replaceAll("»", "\""));
  });

  it("reads UTF-16 by its byte order mark, whatever the declaration says", () => {
    const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(document("UTF-16"), "utf16le")]);
    expect(productName(little)).toBe(NAME);
    const big = Buffer.from(little);
    big.swap16();
    expect(detectCommerceMlEncoding(big)).toBe("utf-16be");
    expect(productName(big)).toBe(NAME);
  });

  it("reads UTF-16 that carries no byte order mark", () => {
    const little = Buffer.from(document("UTF-16LE"), "utf16le");
    expect(detectCommerceMlEncoding(little)).toBe("utf-16le");
    expect(productName(little)).toBe(NAME);
    const big = Buffer.from(document("UTF-16BE"), "utf16le");
    big.swap16();
    expect(detectCommerceMlEncoding(big)).toBe("utf-16be");
    expect(productName(big)).toBe(NAME);
  });

  it("rejects an encoding it cannot read instead of guessing", () => {
    const content = Buffer.from(document("x-mac-cyrillic"), "utf8");
    expect(() => decodeCommerceMl(content)).toThrow(CommerceMlParseError);
    expect(() => decodeCommerceMl(content)).toThrow(/x-mac-cyrillic/u);
  });
});
