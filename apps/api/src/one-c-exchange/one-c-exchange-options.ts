import { z } from "zod";

/**
 * How often a base is expected to send prices and stock unless staff set
 * another interval: the owner's 1С runs the exchange once a day. Only the
 * freshness check and the late-exchange alert read it; 1С starts every exchange.
 */
export const ONE_C_DEFAULT_EXPECTED_SYNC_MINUTES = 24 * 60;

/**
 * Per-base switches of the 1С exchange. They live in
 * app.integration_endpoints.settings (one JSON object per 1С base) and are
 * edited by staff in «Настройки интеграций»; every switch has a safe default,
 * so a base that never saved any setting behaves as documented here.
 */
export const OneCExchangeOptionsSchema = z.object({
  /**
   * Publish the 1С «Описание» of a product on its page. Off by default: in
   * many bases the field holds stock-take notes and shelf numbers
   * («аудит 27 03 2026 КОРОБКА 35»), not a text for customers.
   */
  publishDescriptions: z.boolean().default(false),
});

export type OneCExchangeOptions = z.infer<typeof OneCExchangeOptionsSchema>;

/** The options stored for a base; anything missing or malformed falls back to the defaults. */
export function readOneCExchangeOptions(settings: unknown): OneCExchangeOptions {
  const parsed = OneCExchangeOptionsSchema.safeParse(settings ?? {});
  return parsed.success ? parsed.data : OneCExchangeOptionsSchema.parse({});
}

/**
 * The switches a settings request names. A switch the request does not mention
 * is left out, so its stored value stays (the schema's defaults must not be
 * applied here: they would overwrite a stored choice with the default).
 */
export function namedOneCExchangeOptions(input: Readonly<Record<string, unknown>>): Partial<OneCExchangeOptions> {
  return Object.fromEntries(
    Object.keys(OneCExchangeOptionsSchema.shape).flatMap((key) => (input[key] === undefined ? [] : [[key, input[key]]])),
  ) as Partial<OneCExchangeOptions>;
}
