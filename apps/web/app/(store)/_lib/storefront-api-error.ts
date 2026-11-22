/** A read of the API that did not give the storefront what it asked for; `status` is the API's answer (503 when none). */
export class StorefrontApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "StorefrontApiError";
  }
}
