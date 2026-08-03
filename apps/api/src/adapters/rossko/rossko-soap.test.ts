import { describe, expect, it } from "vitest";

import {
  buildGetSearchEnvelope,
  normaliseSupplierQuery,
  parsePriceToKopeks,
  parseSearchResponseXml,
  supplierCacheKey,
  xmlEscape,
} from "./rossko-soap.js";

describe("xmlEscape", () => {
  it("escapes every character that has XML meaning", () => {
    expect(xmlEscape(`W914/2 & "quoted" <tag> 'apos'`))
      .toBe("W914/2 &amp; &quot;quoted&quot; &lt;tag&gt; &apos;apos&apos;");
  });
});

describe("buildGetSearchEnvelope", () => {
  it("emits KEY1, KEY2, text, delivery_id in that exact order", () => {
    const envelope = buildGetSearchEnvelope({
      deliveryId: "000000001",
      key1: "key-one",
      key2: "key-two",
      text: "W914/2",
    });
    const order = ["<KEY1>", "<KEY2>", "<text>", "<delivery_id>"].map((tag) => envelope.indexOf(tag));
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(order.every((index) => index !== -1)).toBe(true);
    expect(envelope).not.toContain("address_id");
    expect(envelope).toContain("<GetSearch xmlns=\"https://api.rossko.ru/\">");
  });

  it("appends address_id last, only when provided", () => {
    const envelope = buildGetSearchEnvelope({
      addressId: "000000005",
      deliveryId: "000000002",
      key1: "k1",
      key2: "k2",
      text: "90915-YZZD4",
    });
    expect(envelope.indexOf("<delivery_id>")).toBeLessThan(envelope.indexOf("<address_id>"));
  });

  it("XML-escapes every interpolated value so a hostile part number cannot break the envelope", () => {
    const envelope = buildGetSearchEnvelope({
      deliveryId: "000000001",
      key1: "key",
      key2: "key",
      text: `W914/2 & <injected/>`,
    });
    expect(envelope).toContain("W914/2 &amp; &lt;injected/&gt;");
    expect(envelope).not.toContain("<injected/>");
    // The envelope must still be a single well-formed GetSearch element pair.
    expect(envelope.match(/<GetSearch /gu)?.length).toBe(1);
    expect(envelope.match(/<\/GetSearch>/gu)?.length).toBe(1);
  });
});

describe("parsePriceToKopeks", () => {
  it("converts a clean rubles.kopeks string using integer arithmetic", () => {
    expect(parsePriceToKopeks("1234.50")).toBe(123_450);
    expect(parsePriceToKopeks("1234")).toBe(123_400);
    expect(parsePriceToKopeks("0.01")).toBe(1);
    expect(parsePriceToKopeks("  99.90  ")).toBe(9_990);
  });

  it("rejects anything that is not a clean positive amount instead of coercing it", () => {
    expect(parsePriceToKopeks("0")).toBeNull();
    expect(parsePriceToKopeks("0.00")).toBeNull();
    expect(parsePriceToKopeks("-5")).toBeNull();
    expect(parsePriceToKopeks("1,234.50")).toBeNull();
    expect(parsePriceToKopeks("1 234.50")).toBeNull();
    expect(parsePriceToKopeks("1234.567")).toBeNull();
    expect(parsePriceToKopeks("1e3")).toBeNull();
    expect(parsePriceToKopeks("abc")).toBeNull();
    expect(parsePriceToKopeks("")).toBeNull();
    expect(parsePriceToKopeks("+123")).toBeNull();
    expect(parsePriceToKopeks("NaN")).toBeNull();
  });
});

describe("normaliseSupplierQuery", () => {
  it("trims, collapses internal whitespace and upper-cases", () => {
    expect(normaliseSupplierQuery("  w914/2  ")).toBe("W914/2");
    expect(normaliseSupplierQuery("90915   yzzd4")).toBe("90915 YZZD4");
    expect(normaliseSupplierQuery("тормозные колодки")).toBe("ТОРМОЗНЫЕ КОЛОДКИ");
  });
});

describe("supplierCacheKey", () => {
  it("is stable for the same normalised query and delivery id", () => {
    const a = supplierCacheKey("W914/2", "000000001");
    const b = supplierCacheKey("W914/2", "000000001");
    expect(a).toBe(b);
    expect(a).toMatch(/^an30:rossko:search:[a-f0-9]{64}$/u);
  });

  it("differs when the query or the delivery id differs", () => {
    const base = supplierCacheKey("W914/2", "000000001");
    expect(supplierCacheKey("90915-YZZD4", "000000001")).not.toBe(base);
    expect(supplierCacheKey("W914/2", "000000002")).not.toBe(base);
  });
});

const ENVELOPE_OPEN = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetSearchResponse xmlns="https://api.rossko.ru/">
      <GetSearchResult>`;
const ENVELOPE_CLOSE = `
      </GetSearchResult>
    </GetSearchResponse>
  </soap:Body>
</soap:Envelope>`;

describe("parseSearchResponseXml", () => {
  it("parses a successful response with stocks and nested analogues (crosses)", () => {
    const xml = `${ENVELOPE_OPEN}
        <success>true</success>
        <text>W914/2</text>
        <message>OK</message>
        <PartsList>
          <Part>
            <guid>part-guid-1</guid>
            <brand>MANN</brand>
            <partnumber>W914/2</partnumber>
            <name>Масляный фильтр</name>
            <stocks>
              <Stock>
                <id>stock-1</id>
                <price>456.70</price>
                <count>12</count>
                <delivery_time>2</delivery_time>
              </Stock>
              <Stock>
                <id>stock-2</id>
                <price>399.00</price>
                <count>0</count>
                <delivery_time></delivery_time>
              </Stock>
            </stocks>
            <crosses>
              <Part>
                <guid>cross-guid-1</guid>
                <brand>MAHLE</brand>
                <partnumber>OC90</partnumber>
                <name>Масляный фильтр аналог</name>
                <stocks>
                  <Stock>
                    <id>stock-3</id>
                    <price>410.00</price>
                    <count>5</count>
                    <delivery_time>3</delivery_time>
                  </Stock>
                </stocks>
                <crosses></crosses>
              </Part>
            </crosses>
          </Part>
        </PartsList>${ENVELOPE_CLOSE}`;

    const result = parseSearchResponseXml(xml);
    expect(result.success).toBe(true);
    expect(result.message).toBe("OK");
    expect(result.parts).toHaveLength(1);

    const [part] = result.parts;
    expect(part).toMatchObject({ brand: "MANN", guid: "part-guid-1", name: "Масляный фильтр", partNumber: "W914/2" });
    expect(part!.stocks).toEqual([
      { deliveryTime: "2", id: "stock-1", priceKopeks: 45_670, quantity: 12 },
      { deliveryTime: null, id: "stock-2", priceKopeks: 39_900, quantity: 0 },
    ]);
    expect(part!.crosses).toHaveLength(1);
    expect(part!.crosses[0]).toMatchObject({ brand: "MAHLE", guid: "cross-guid-1", partNumber: "OC90" });
    expect(part!.crosses[0]!.stocks).toEqual([
      { deliveryTime: "3", id: "stock-3", priceKopeks: 41_000, quantity: 5 },
    ]);
  });

  it("keeps a part with no stock lines instead of dropping it", () => {
    const xml = `${ENVELOPE_OPEN}
        <success>true</success>
        <text>NOSTOCK</text>
        <message>OK</message>
        <PartsList>
          <Part>
            <guid>part-guid-2</guid>
            <brand>BOSCH</brand>
            <partnumber>NOSTOCK</partnumber>
            <name>Деталь без остатка</name>
            <stocks></stocks>
            <crosses></crosses>
          </Part>
        </PartsList>${ENVELOPE_CLOSE}`;

    const result = parseSearchResponseXml(xml);
    expect(result.success).toBe(true);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.stocks).toEqual([]);
  });

  it("drops a stock line whose price cannot be parsed cleanly, keeping the rest", () => {
    const xml = `${ENVELOPE_OPEN}
        <success>true</success>
        <text>BADPRICE</text>
        <message>OK</message>
        <PartsList>
          <Part>
            <guid>part-guid-3</guid>
            <brand>LUK</brand>
            <partnumber>BADPRICE</partnumber>
            <name>Деталь</name>
            <stocks>
              <Stock>
                <id>stock-bad</id>
                <price>not-a-price</price>
                <count>4</count>
                <delivery_time>1</delivery_time>
              </Stock>
              <Stock>
                <id>stock-good</id>
                <price>10.00</price>
                <count>2</count>
                <delivery_time>1</delivery_time>
              </Stock>
            </stocks>
            <crosses></crosses>
          </Part>
        </PartsList>${ENVELOPE_CLOSE}`;

    const result = parseSearchResponseXml(xml);
    expect(result.parts[0]!.stocks).toEqual([{ deliveryTime: "1", id: "stock-good", priceKopeks: 1_000, quantity: 2 }]);
  });

  it("reports a supplier-side failure without throwing", () => {
    const xml = `${ENVELOPE_OPEN}
        <success>false</success>
        <text>UNKNOWN</text>
        <message>Указанный тип доставки не найден</message>
      </GetSearchResult>
    </GetSearchResponse>
  </soap:Body>
</soap:Envelope>`;

    const result = parseSearchResponseXml(xml);
    expect(result).toEqual({ message: "Указанный тип доставки не найден", parts: [], success: false });
  });

  it("returns a clean failure for truncated XML instead of throwing", () => {
    const result = parseSearchResponseXml(`${ENVELOPE_OPEN}<success>true</success><message>OK`);
    expect(result.success).toBe(false);
    expect(result.parts).toEqual([]);
  });

  it("returns a clean failure for mismatched tags instead of throwing", () => {
    const xml = `${ENVELOPE_OPEN}
        <success>true</success>
        <message>OK</message>
        <PartsList><Part><guid>x</guid></Wrong></PartsList>${ENVELOPE_CLOSE}`;
    const result = parseSearchResponseXml(xml);
    expect(result.success).toBe(false);
    expect(result.parts).toEqual([]);
  });

  it("returns a clean failure for a document with no recognisable result shape", () => {
    const result = parseSearchResponseXml("<html><body>Service Unavailable</body></html>");
    expect(result).toEqual({ message: "Поставщик вернул неожиданный ответ", parts: [], success: false });
  });

  it("returns a clean failure for an empty body", () => {
    expect(parseSearchResponseXml("")).toEqual({
      message: "Не удалось разобрать ответ поставщика",
      parts: [],
      success: false,
    });
  });

  it("decodes XML entities in text content", () => {
    const xml = `${ENVELOPE_OPEN}
        <success>true</success>
        <message>OK</message>
        <PartsList>
          <Part>
            <guid>g</guid>
            <brand>M&amp;M</brand>
            <partnumber>A&lt;B</partnumber>
            <name>&quot;Название&quot;</name>
            <stocks></stocks>
            <crosses></crosses>
          </Part>
        </PartsList>${ENVELOPE_CLOSE}`;
    const result = parseSearchResponseXml(xml);
    expect(result.parts[0]).toMatchObject({ brand: "M&M", name: `"Название"`, partNumber: "A<B" });
  });
});
