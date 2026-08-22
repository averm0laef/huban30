/**
 * User-Agent is supporting consent evidence, not an unbounded copy of an
 * attacker-controlled header. Keep printable text only and match the database
 * limit used by every consent-evidence table.
 */
export function normalizeConsentUserAgent(value: string | undefined): string | null {
  const normalized = value?.replace(/[\u0000-\u001F\u007F]/gu, " ").trim();
  return normalized ? normalized.slice(0, 1_024) : null;
}
