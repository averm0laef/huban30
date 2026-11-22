/**
 * A failure the parts finder reports to the customer: HTTP status, a stable
 * code and a Russian message (port of FapiError / ProviderError / InvalidVIN
 * from the original Python module, docs/PARTS_FINDER.md).
 */
export class PartsFinderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PartsFinderError";
  }
}
